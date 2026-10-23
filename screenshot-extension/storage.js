// All data access goes through this module so it can later be swapped for
// (or synced with) Supabase without touching the UI.
//
// Layout in chrome.storage.local:
//   folders        -> [{ id, name, createdAt }]
//   shots          -> [{ id, folderId, title, pageUrl, createdAt, width, height }]
//   currentFolder  -> folder id used for new captures
//   img:<shotId>   -> PNG data URL (kept separate so listing stays cheap)

const store = chrome.storage.local;

export const DEFAULT_FOLDER_ID = "default";

const uid = () => crypto.randomUUID();

async function get(key, fallback) {
  const res = await store.get(key);
  return res[key] ?? fallback;
}

async function ensureDefaults() {
  const folders = await get("folders", null);
  if (!folders) {
    await store.set({
      folders: [{ id: DEFAULT_FOLDER_ID, name: "Unsorted", createdAt: Date.now() }],
      shots: [],
      currentFolder: DEFAULT_FOLDER_ID,
    });
  }
}

// ---------- Folders ----------

export async function listFolders() {
  await ensureDefaults();
  return get("folders", []);
}

export async function createFolder(name) {
  name = name.trim();
  if (!name) throw new Error("Folder name is required");
  const folders = await listFolders();
  if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A folder with that name already exists");
  }
  const folder = { id: uid(), name, createdAt: Date.now() };
  await store.set({ folders: [...folders, folder] });
  return folder;
}

export async function renameFolder(id, name) {
  name = name.trim();
  if (!name) throw new Error("Folder name is required");
  const folders = await listFolders();
  if (folders.some((f) => f.id !== id && f.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("A folder with that name already exists");
  }
  await store.set({ folders: folders.map((f) => (f.id === id ? { ...f, name } : f)) });
}

// Deleting a folder deletes its screenshots too.
export async function deleteFolder(id) {
  if (id === DEFAULT_FOLDER_ID) throw new Error("The Unsorted folder can't be deleted");
  const folders = await listFolders();
  const shots = await get("shots", []);
  const doomed = shots.filter((s) => s.folderId === id);
  await store.remove(doomed.map((s) => `img:${s.id}`));
  const update = {
    folders: folders.filter((f) => f.id !== id),
    shots: shots.filter((s) => s.folderId !== id),
  };
  if ((await getCurrentFolder()) === id) update.currentFolder = DEFAULT_FOLDER_ID;
  await store.set(update);
}

export async function getCurrentFolder() {
  await ensureDefaults();
  const id = await get("currentFolder", DEFAULT_FOLDER_ID);
  const folders = await get("folders", []);
  return folders.some((f) => f.id === id) ? id : DEFAULT_FOLDER_ID;
}

export async function setCurrentFolder(id) {
  await store.set({ currentFolder: id });
}

// ---------- Screenshots ----------

export async function listShots(folderId) {
  await ensureDefaults();
  const shots = await get("shots", []);
  return shots
    .filter((s) => !folderId || s.folderId === folderId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function addShot({ folderId, dataUrl, title, pageUrl, width, height }) {
  await ensureDefaults();
  const shot = {
    id: uid(),
    folderId: folderId || DEFAULT_FOLDER_ID,
    title: title || "Screenshot",
    pageUrl: pageUrl || "",
    createdAt: Date.now(),
    width,
    height,
  };
  const shots = await get("shots", []);
  await store.set({ shots: [...shots, shot], [`img:${shot.id}`]: dataUrl });
  return shot;
}

export async function getShotImage(id) {
  return get(`img:${id}`, null);
}

export async function moveShot(id, folderId) {
  const shots = await get("shots", []);
  await store.set({ shots: shots.map((s) => (s.id === id ? { ...s, folderId } : s)) });
}

export async function renameShot(id, title) {
  const shots = await get("shots", []);
  await store.set({ shots: shots.map((s) => (s.id === id ? { ...s, title: title.trim() || s.title } : s)) });
}

export async function deleteShot(id) {
  const shots = await get("shots", []);
  await store.set({ shots: shots.filter((s) => s.id !== id) });
  await store.remove(`img:${id}`);
}

// ---------- Helpers ----------

// Turns a name into something safe for a file/folder path.
export function safeName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "untitled";
}

export function fileNameFor(shot) {
  const d = new Date(shot.createdAt);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${safeName(shot.title)}_${stamp}.png`;
}

// Saves a screenshot to Downloads/Snap Folders/<folder>/<file>.png
export async function downloadShot(shot) {
  const folders = await listFolders();
  const folder = folders.find((f) => f.id === shot.folderId);
  const dataUrl = await getShotImage(shot.id);
  if (!dataUrl) throw new Error("Image not found");
  return chrome.downloads.download({
    url: dataUrl,
    filename: `Snap Folders/${safeName(folder?.name || "Unsorted")}/${fileNameFor(shot)}`,
    conflictAction: "uniquify",
  });
}
