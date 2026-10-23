import { addShot, getCurrentFolder } from "./storage.js";
import { getSession, signInWithGoogle } from "./auth.js";

async function requireSignIn() {
  if (!(await getSession())) {
    chrome.action.openPopup?.().catch(() => {});
    throw new Error("Please sign in first");
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");
  return tab;
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function cropDataUrl(dataUrl, rect, dpr) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.min(Math.round(rect.width * dpr), bitmap.width - sx);
  const sh = Math.min(Math.round(rect.height * dpr), bitmap.height - sy);
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return { dataUrl: await blobToDataUrl(blob), width: sw, height: sh };
}

async function imageSize(dataUrl) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  return { width: bitmap.width, height: bitmap.height };
}

async function captureVisible(tab, rect, dpr) {
  let dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  let size;
  if (rect) {
    ({ dataUrl, ...size } = await cropDataUrl(dataUrl, rect, dpr));
  } else {
    size = await imageSize(dataUrl);
  }
  const shot = await addShot({
    folderId: await getCurrentFolder(),
    dataUrl,
    title: tab.title,
    pageUrl: tab.url,
    ...size,
  });
  flashBadge("✓", "#16a34a");
  chrome.runtime.sendMessage({ type: "shot-added", shot }).catch(() => {});
  return shot;
}

async function startRegionSelect(tab) {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["selector.js"] });
}

async function handle(mode) {
  await requireSignIn();
  const tab = await activeTab();
  if (mode === "region") return startRegionSelect(tab);
  return captureVisible(tab);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "capture") {
    handle(msg.mode)
      .then((shot) => sendResponse({ ok: true, shot }))
      .catch((err) => {
        flashBadge("!", "#dc2626");
        sendResponse({ ok: false, error: friendlyError(err) });
      });
    return true; // async response
  }
  if (msg.type === "google-signin") {
    // The popup usually closes when the OAuth window opens, so errors are also
    // left in session storage for the popup to show next time it opens.
    chrome.storage.session.remove("authError");
    signInWithGoogle()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        chrome.storage.session.set({ authError: err.message });
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
  if (msg.type === "region-selected" && sender.tab) {
    requireSignIn()
      .then(() => captureVisible(sender.tab, msg.rect, msg.dpr))
      .catch((err) => {
        console.error(err);
        flashBadge("!", "#dc2626");
      });
  }
});

chrome.commands.onCommand.addListener((command) => {
  const mode = command === "capture-region" ? "region" : "visible";
  handle(mode).catch((err) => {
    console.error(err);
    flashBadge("!", "#dc2626");
  });
});

function friendlyError(err) {
  const msg = String(err?.message || err);
  if (/cannot be scripted|chrome:\/\/|Cannot access|edge:\/\/|webstore/i.test(msg)) {
    return "Chrome doesn't allow capturing this page (browser/system pages and the Web Store are blocked).";
  }
  return msg;
}
