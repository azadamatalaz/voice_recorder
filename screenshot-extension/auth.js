// Minimal Supabase Auth client built on the REST API (no bundler needed).
// The session is kept in chrome.storage.local so the popup, gallery and
// background worker all share it.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const AUTH_URL = `${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1`;
const SESSION_KEY = "session";

export function isConfigured() {
  return !SUPABASE_URL.includes("YOUR-PROJECT-REF") && !SUPABASE_ANON_KEY.startsWith("YOUR-");
}

async function request(path, { method = "POST", body, token } = {}) {
  const headers = { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${AUTH_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach Supabase. Check your connection and config.js.");
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const err = new Error(data.error_description || data.msg || data.message || data.error || `Auth error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Session storage ----------

async function saveSession(data) {
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user,
  };
  await chrome.storage.local.set({ [SESSION_KEY]: session });
  return session;
}

async function clearSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}

let refreshing = null;

async function refresh(session) {
  // Share one in-flight refresh between concurrent callers in this context.
  refreshing ??= request("/token?grant_type=refresh_token", {
    body: { refresh_token: session.refresh_token },
  })
    .then(saveSession)
    .catch(async (err) => {
      // Only a rejected refresh token means the user is signed out; keep the
      // session on network errors so a flaky connection doesn't log them out.
      if (err.status === 400 || err.status === 401) await clearSession();
      throw err;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

// Returns a valid session (refreshing it if it is about to expire) or null.
export async function getSession() {
  const { [SESSION_KEY]: session } = await chrome.storage.local.get(SESSION_KEY);
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session;
  try {
    return await refresh(session);
  } catch {
    const { [SESSION_KEY]: still } = await chrome.storage.local.get(SESSION_KEY);
    return still ?? null;
  }
}

export async function getUser() {
  return (await getSession())?.user ?? null;
}

export function onAuthChange(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(SESSION_KEY in changes)) return;
    const before = changes[SESSION_KEY].oldValue?.user?.id;
    const after = changes[SESSION_KEY].newValue?.user?.id;
    if (before !== after) callback(changes[SESSION_KEY].newValue?.user ?? null);
  });
}

// ---------- Email + password ----------

// Returns { needsConfirmation: true } when the project requires email confirmation.
export async function signUpWithEmail(email, password) {
  const data = await request("/signup", { body: { email, password } });
  if (data.access_token) {
    await saveSession(data);
    return { needsConfirmation: false };
  }
  return { needsConfirmation: true };
}

export async function signInWithEmail(email, password) {
  return saveSession(await request("/token?grant_type=password", { body: { email, password } }));
}

// ---------- Google (OAuth + PKCE) ----------
// Must run in the background worker: the OAuth window steals focus and would
// close the popup mid-flow.

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function signInWithGoogle() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const redirectTo = chrome.identity.getRedirectURL();

  const authorizeUrl = `${AUTH_URL}/authorize?${new URLSearchParams({
    provider: "google",
    redirect_to: redirectTo,
    code_challenge: challenge,
    code_challenge_method: "s256",
    prompt: "select_account",
  })}`;

  let responseUrl;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl, interactive: true });
  } catch (err) {
    throw new Error(/did not approve|cancel/i.test(err.message) ? "Google sign-in was cancelled" : err.message);
  }

  const url = new URL(responseUrl);
  const params = new URLSearchParams(url.search);
  new URLSearchParams(url.hash.slice(1)).forEach((v, k) => params.set(k, v));

  if (params.get("error")) {
    throw new Error(params.get("error_description") || params.get("error"));
  }
  const code = params.get("code");
  if (!code) throw new Error("Google sign-in didn't return an authorization code");

  return saveSession(await request("/token?grant_type=pkce", { body: { auth_code: code, code_verifier: verifier } }));
}

// ---------- Sign out ----------

export async function signOut() {
  const { [SESSION_KEY]: session } = await chrome.storage.local.get(SESSION_KEY);
  await clearSession();
  if (session?.access_token) {
    // Revoke on the server too; ignore failures (e.g. already expired).
    request("/logout", { token: session.access_token }).catch(() => {});
  }
}
