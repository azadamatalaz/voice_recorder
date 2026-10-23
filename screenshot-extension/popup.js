import {
  listFolders,
  createFolder,
  getCurrentFolder,
  setCurrentFolder,
  listShots,
  getShotImage,
} from "./storage.js";
import { isConfigured, getUser, signInWithEmail, signUpWithEmail, signOut, onAuthChange } from "./auth.js";

const $ = (id) => document.getElementById(id);
const folderSelect = $("folder");
const errorEl = $("error");

function showError(msg) {
  errorEl.textContent = msg || "";
}

async function renderFolders() {
  const [folders, current] = await Promise.all([listFolders(), getCurrentFolder()]);
  folderSelect.replaceChildren(
    ...folders.map((f) => {
      const opt = new Option(f.name, f.id);
      opt.selected = f.id === current;
      return opt;
    })
  );
}

async function renderRecent() {
  const shots = (await listShots(folderSelect.value)).slice(0, 6);
  const grid = $("recent");
  if (!shots.length) {
    grid.innerHTML = '<div class="muted empty" style="grid-column:1/-1">No screenshots yet</div>';
    return;
  }
  const cards = await Promise.all(
    shots.map(async (s) => {
      const card = document.createElement("div");
      card.className = "thumb";
      const img = document.createElement("img");
      img.src = await getShotImage(s.id);
      img.title = s.title;
      img.addEventListener("click", () => openGallery(s.id));
      card.append(img);
      return card;
    })
  );
  grid.replaceChildren(...cards);
}

function openGallery(shotId) {
  const params = new URLSearchParams({ folder: folderSelect.value });
  if (shotId) params.set("shot", shotId);
  chrome.tabs.create({ url: `gallery.html?${params}` });
}

folderSelect.addEventListener("change", async () => {
  await setCurrentFolder(folderSelect.value);
  renderRecent();
});

$("new-folder-btn").addEventListener("click", () => {
  $("new-folder-form").classList.toggle("hidden");
  $("new-folder-name").focus();
});

$("new-folder-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError();
  try {
    const folder = await createFolder($("new-folder-name").value);
    await setCurrentFolder(folder.id);
    $("new-folder-name").value = "";
    $("new-folder-form").classList.add("hidden");
    await renderFolders();
    renderRecent();
  } catch (err) {
    showError(err.message);
  }
});

async function capture(mode) {
  showError();
  await setCurrentFolder(folderSelect.value);
  const res = await chrome.runtime.sendMessage({ type: "capture", mode });
  if (!res?.ok) return showError(res?.error || "Capture failed");
  if (mode === "region") window.close(); // let the user drag on the page
}

$("capture-visible").addEventListener("click", () => capture("visible"));
$("capture-region").addEventListener("click", () => capture("region"));
$("open-gallery").addEventListener("click", () => openGallery());

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "shot-added") renderRecent();
});

// ---------- Auth ----------

let authMode = "signin";

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("auth-submit").textContent = mode === "signin" ? "Sign in" : "Create account";
  $("password").autocomplete = mode === "signin" ? "current-password" : "new-password";
  authMessage();
}

function authMessage(error, notice) {
  $("auth-error").textContent = error || "";
  $("auth-message").textContent = notice || "";
  $("auth-message").classList.toggle("hidden", !notice);
}

function setBusy(busy) {
  $("auth-submit").disabled = busy;
  $("google-btn").disabled = busy;
}

document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => setAuthMode(b.dataset.mode))
);

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  authMessage();
  setBusy(true);
  const email = $("email").value.trim();
  const password = $("password").value;
  try {
    if (authMode === "signin") {
      await signInWithEmail(email, password);
    } else {
      const { needsConfirmation } = await signUpWithEmail(email, password);
      if (needsConfirmation) {
        setAuthMode("signin");
        authMessage(null, `We sent a confirmation link to ${email}. Click it, then sign in here.`);
      }
    }
  } catch (err) {
    authMessage(err.message);
  } finally {
    setBusy(false);
  }
});

$("google-btn").addEventListener("click", async () => {
  authMessage();
  setBusy(true);
  // Runs in the background worker; this popup will likely close when the
  // Google window opens; the session is picked up next time it opens.
  const res = await chrome.runtime.sendMessage({ type: "google-signin" });
  setBusy(false);
  if (!res?.ok) authMessage(res?.error || "Google sign-in failed");
});

$("sign-out").addEventListener("click", () => signOut());

async function render() {
  for (const id of ["setup-view", "auth-view", "app-view"]) $(id).classList.add("hidden");
  if (!isConfigured()) return $("setup-view").classList.remove("hidden");

  const user = await getUser();
  if (!user) {
    $("auth-view").classList.remove("hidden");
    const { authError } = await chrome.storage.session.get("authError");
    if (authError) {
      authMessage(authError);
      chrome.storage.session.remove("authError");
    }
    return;
  }

  $("account").textContent = user.email;
  $("account").title = user.email;
  $("app-view").classList.remove("hidden");
  await renderFolders();
  renderRecent();
}

onAuthChange(render);
render();
