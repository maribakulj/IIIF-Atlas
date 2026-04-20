/**
 * Region-selection overlay, injected from the content script.
 *
 * Given a target <img> (matched by URL) we drop a full-viewport overlay
 * the user can drag a rectangle on. On commit we convert CSS-pixel
 * coordinates to intrinsic image pixels (using naturalWidth/Height) and
 * call back with an "x,y,w,h" string suitable for an xywh fragment.
 *
 * If the target image isn't on the page (or isn't loaded yet) we abort
 * cleanly — better to let the user retry than to guess.
 */

export interface RegionSelection {
  imageUrl: string;
  regionXywh: string;
  intrinsic: { width: number; height: number };
}

const OVERLAY_ID = "iiif-atlas-region-overlay";

export function startRegionSelect(targetImageUrl: string): Promise<RegionSelection | null> {
  return new Promise((resolve) => {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();

    const img = findImage(targetImageUrl);
    if (!img) {
      resolve(null);
      return;
    }
    if (!img.complete || img.naturalWidth === 0) {
      resolve(null);
      return;
    }

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483646",
      cursor: "crosshair",
      background: "rgba(15, 17, 21, 0.35)",
    } satisfies Partial<CSSStyleDeclaration>);

    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "absolute",
      border: "2px solid #4f8cff",
      background: "rgba(79, 140, 255, 0.15)",
      pointerEvents: "none",
      display: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    overlay.appendChild(box);

    const hint = document.createElement("div");
    hint.textContent = "Drag to select a region. Esc to cancel.";
    Object.assign(hint.style, {
      position: "fixed",
      top: "12px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "6px 10px",
      background: "#0f1115",
      color: "#e8ebf0",
      border: "1px solid #2a2f3a",
      borderRadius: "6px",
      font: "13px/1.3 system-ui, sans-serif",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    overlay.appendChild(hint);

    document.body.appendChild(overlay);

    let start: { x: number; y: number } | null = null;

    function cleanup() {
      overlay.remove();
      window.removeEventListener("keydown", onKey, true);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        cleanup();
        resolve(null);
      }
    }
    window.addEventListener("keydown", onKey, true);

    overlay.addEventListener("pointerdown", (e) => {
      start = { x: e.clientX, y: e.clientY };
      box.style.display = "block";
      box.style.left = `${start.x}px`;
      box.style.top = `${start.y}px`;
      box.style.width = "0px";
      box.style.height = "0px";
      overlay.setPointerCapture(e.pointerId);
    });
    overlay.addEventListener("pointermove", (e) => {
      if (!start) return;
      const x = Math.min(start.x, e.clientX);
      const y = Math.min(start.y, e.clientY);
      const w = Math.abs(e.clientX - start.x);
      const h = Math.abs(e.clientY - start.y);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
    });
    overlay.addEventListener("pointerup", (e) => {
      if (!start) {
        cleanup();
        resolve(null);
        return;
      }
      const x1 = Math.min(start.x, e.clientX);
      const y1 = Math.min(start.y, e.clientY);
      const x2 = Math.max(start.x, e.clientX);
      const y2 = Math.max(start.y, e.clientY);
      cleanup();
      if (x2 - x1 < 4 || y2 - y1 < 4) {
        resolve(null);
        return;
      }
      resolve(toIntrinsic(img, x1, y1, x2, y2));
    });
  });
}

function findImage(url: string): HTMLImageElement | null {
  const imgs = Array.from(document.images);
  const exact = imgs.find((i) => i.currentSrc === url || i.src === url);
  if (exact) return exact;
  // Relative fallback: compare absolute URLs.
  for (const i of imgs) {
    try {
      if (new URL(i.src, document.baseURI).toString() === url) return i;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function toIntrinsic(
  img: HTMLImageElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): RegionSelection | null {
  const rect = img.getBoundingClientRect();
  const ix1 = Math.max(x1, rect.left);
  const iy1 = Math.max(y1, rect.top);
  const ix2 = Math.min(x2, rect.right);
  const iy2 = Math.min(y2, rect.bottom);
  if (ix2 <= ix1 || iy2 <= iy1) return null;

  const scaleX = img.naturalWidth / rect.width;
  const scaleY = img.naturalHeight / rect.height;
  const x = Math.round((ix1 - rect.left) * scaleX);
  const y = Math.round((iy1 - rect.top) * scaleY);
  const w = Math.round((ix2 - ix1) * scaleX);
  const h = Math.round((iy2 - iy1) * scaleY);
  if (w < 1 || h < 1) return null;

  return {
    imageUrl: img.currentSrc || img.src,
    regionXywh: `${x},${y},${w},${h}`,
    intrinsic: { width: img.naturalWidth, height: img.naturalHeight },
  };
}
