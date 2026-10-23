// Injected into the page: lets the user drag a rectangle, then reports it
// (in CSS pixels, relative to the viewport) back to the background worker.
(() => {
  if (window.__snapFoldersSelecting) return;
  window.__snapFoldersSelecting = true;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.25);user-select:none;";
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,.12);box-shadow:0 0 0 99999px rgba(0,0,0,.35);display:none;pointer-events:none;";
  const hint = document.createElement("div");
  hint.textContent = "Drag to select an area · Esc to cancel";
  hint.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:6px;background:#111827;color:#fff;font:13px system-ui,sans-serif;pointer-events:none;";
  overlay.append(box, hint);
  document.documentElement.appendChild(overlay);

  let start = null;
  let rect = null;

  const cleanup = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    window.__snapFoldersSelecting = false;
  };

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cleanup();
    }
  };
  document.addEventListener("keydown", onKey, true);

  overlay.addEventListener("mousedown", (e) => {
    start = { x: e.clientX, y: e.clientY };
    overlay.style.background = "transparent";
    hint.style.display = "none";
    box.style.display = "block";
  });

  overlay.addEventListener("mousemove", (e) => {
    if (!start) return;
    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    rect = { x, y, width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y) };
    Object.assign(box.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  });

  overlay.addEventListener("mouseup", () => {
    const selected = rect;
    cleanup();
    if (!selected || selected.width < 5 || selected.height < 5) return;
    // Wait for the overlay to disappear from the rendered frame before capturing.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: "region-selected", rect: selected, dpr: window.devicePixelRatio });
        }, 50)
      )
    );
  });
})();
