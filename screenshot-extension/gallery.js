import {
  DEFAULT_FOLDER_ID,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  listShots,
  getShotImage,
  moveShot,
  renameShot,
  deleteShot,
  downloadShot,
} from "./storage.js";
import { getUser, signOut, onAuthChange } from "./auth.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let currentFolder = params.get("folder") || DEFAULT_FOLDER_ID;

function showError(msg) {
  $("error").textContent = msg || "";
}

async function renderFolders() {
  const [folders, shots] = await Promise.all([listFolders(), listShots()]);
  if (!folders.some((f) => f.id === currentFolder)) currentFolder = DEFAULT_FOLDER_ID;

  $("folders").replaceChildren(
    ...folders.map((f) => {
      const li = document.createElement("li");
      li.classList.toggle("active", f.id === currentFolder);
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = f.name;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = shots.filter((s) => s.folderId === f.id).length;
      li.append(name, count);
      li.addEventListener("click", () => selectFolder(f.id));
      return li;
    })
  );

  const folder = folders.find((f) => f.id === currentFolder);
  $("folder-title").textContent = folder.name;
  document.title = `${folder.name} · Snap Folders`;
  const isDefault = currentFolder === DEFAULT_FOLDER_ID;
  $("rename-folder").disabled = isDefault;
  $("delete-folder").classList.toggle("hidden", isDefault);
  return folders;
}

async function renderShots(folders) {
  const shots = await listShots(currentFolder);
  const grid = $("shots");
  $("download-folder").disabled = !shots.length;
  if (!shots.length) {
    grid.innerHTML =
      '<div class="muted empty" style="grid-column:1/-1">This folder is empty. Use the toolbar button to take a screenshot.</div>';
    return;
  }
  const cards = await Promise.all(shots.map((s) => shotCard(s, folders)));
  grid.replaceChildren(...cards);
}

async function shotCard(shot, folders) {
  const card = document.createElement("div");
  card.className = "thumb";

  const img = document.createElement("img");
  img.src = await getShotImage(shot.id);
  img.alt = shot.title;
  img.addEventListener("click", () => openLightbox(img.src));

  const meta = document.createElement("div");
  meta.className = "meta";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = shot.title;
  title.title = shot.pageUrl || shot.title;
  const info = document.createElement("div");
  info.className = "muted";
  info.textContent = `${new Date(shot.createdAt).toLocaleString()} · ${shot.width}×${shot.height}`;
  meta.append(title, info);

  const actions = document.createElement("div");
  actions.className = "actions";

  const move = document.createElement("select");
  move.title = "Move to folder";
  move.append(...folders.map((f) => new Option(f.name, f.id, false, f.id === shot.folderId)));
  move.addEventListener("change", async () => {
    await moveShot(shot.id, move.value);
    refresh();
  });

  const btn = (label, cls, onClick) => {
    const b = document.createElement("button");
    b.className = `icon ${cls}`;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };

  actions.append(
    move,
    btn("Rename", "", async () => {
      const name = prompt("Screenshot name", shot.title);
      if (name !== null) {
        await renameShot(shot.id, name);
        refresh();
      }
    }),
    btn("Download", "", () => downloadShot(shot).catch((e) => showError(e.message))),
    btn("Delete", "danger", async () => {
      if (confirm("Delete this screenshot?")) {
        await deleteShot(shot.id);
        refresh();
      }
    })
  );

  card.append(img, meta, actions);
  return card;
}

function openLightbox(src) {
  $("lightbox").querySelector("img").src = src;
  $("lightbox").classList.remove("hidden");
}
$("lightbox").addEventListener("click", () => $("lightbox").classList.add("hidden"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("lightbox").classList.add("hidden");
});

function selectFolder(id) {
  currentFolder = id;
  history.replaceState(null, "", `?folder=${encodeURIComponent(id)}`);
  refresh();
}

async function refresh() {
  showError();
  const folders = await renderFolders();
  await renderShots(folders);
}

$("new-folder-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError();
  try {
    const folder = await createFolder($("new-folder-name").value);
    $("new-folder-name").value = "";
    selectFolder(folder.id);
  } catch (err) {
    showError(err.message);
  }
});

$("rename-folder").addEventListener("click", async () => {
  const name = prompt("Folder name", $("folder-title").textContent);
  if (name === null) return;
  try {
    await renameFolder(currentFolder, name);
    refresh();
  } catch (err) {
    showError(err.message);
  }
});

$("delete-folder").addEventListener("click", async () => {
  const count = (await listShots(currentFolder)).length;
  const msg = count
    ? `Delete this folder and its ${count} screenshot(s)? This can't be undone.`
    : "Delete this folder?";
  if (!confirm(msg)) return;
  await deleteFolder(currentFolder);
  selectFolder(DEFAULT_FOLDER_ID);
});

$("download-folder").addEventListener("click", async () => {
  for (const shot of await listShots(currentFolder)) {
    await downloadShot(shot).catch((e) => showError(e.message));
  }
});

// Live-update when screenshots are taken from another window/tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.shots || changes.folders)) refresh();
});

$("sign-out").addEventListener("click", () => signOut());
onAuthChange(() => location.reload());

const user = await getUser();
if (!user) {
  $("signed-out").classList.remove("hidden");
  throw new Error("Signed out"); // stop here; reloads on sign-in
}
$("account").textContent = user.email;
$("account").title = user.email;

await refresh();

const openShot = params.get("shot");
if (openShot) {
  const src = await getShotImage(openShot);
  if (src) openLightbox(src);
}
