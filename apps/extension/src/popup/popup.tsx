import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CapturePayload, DetectResult, IngestionMode } from "@iiif-atlas/shared";
import { postCapture } from "../lib/api.js";

function Popup() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [detect, setDetect] = useState<DetectResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<IngestionMode>("reference");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      setTab(activeTab ?? null);
      if (!activeTab?.id) return;
      try {
        const res = (await chrome.tabs.sendMessage(activeTab.id, {
          type: "iiif-atlas:detect",
        })) as DetectResult | undefined;
        if (res) {
          setDetect(res);
          if (res.primaryImageUrl) setSelected([res.primaryImageUrl]);
          if (res.manifestUrl || res.infoJsonUrl) setMode("iiif_reuse");
        }
      } catch (err) {
        setError(
          "Could not read the page. Reload the tab after installing the extension.",
        );
      }
    })();
  }, []);

  function toggle(url: string) {
    setSelected((prev) =>
      prev.includes(url) ? prev.filter((x) => x !== url) : [...prev, url],
    );
  }

  async function addSelected() {
    if (!tab) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      // If IIIF reuse, we only send one capture tied to the manifest.
      if (mode === "iiif_reuse") {
        const payload: CapturePayload = {
          pageUrl: tab.url ?? "",
          pageTitle: tab.title ?? detect?.pageTitle,
          imageUrl: selected[0] ?? detect?.primaryImageUrl,
          manifestUrl: detect?.manifestUrl,
          infoJsonUrl: detect?.infoJsonUrl,
          mode,
          capturedAt: new Date().toISOString(),
        };
        await postCapture(payload);
        setOk("IIIF resource added");
        return;
      }

      // Otherwise POST one capture per selected image.
      const urls = selected.length > 0 ? selected : detect?.primaryImageUrl ? [detect.primaryImageUrl] : [];
      if (urls.length === 0) throw new Error("No image selected");
      for (const imageUrl of urls) {
        const payload: CapturePayload = {
          pageUrl: tab.url ?? "",
          pageTitle: tab.title ?? detect?.pageTitle,
          imageUrl,
          mode,
          capturedAt: new Date().toISOString(),
        };
        await postCapture(payload);
      }
      setOk(`${urls.length} item(s) added`);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  const candidates = detect?.imageCandidates ?? [];
  const isIIIF = Boolean(detect?.manifestUrl || detect?.infoJsonUrl);

  return (
    <div>
      <h1>IIIF Atlas</h1>
      <div className="muted">{tab?.title}</div>

      {isIIIF && (
        <div className="iiif-banner">
          <strong>IIIF detected</strong>
          <div className="muted" style={{ wordBreak: "break-all" }}>
            {detect?.manifestUrl ?? detect?.infoJsonUrl}
          </div>
        </div>
      )}

      <label style={{ display: "block", margin: "8px 0" }}>
        <div className="muted">Ingestion mode</div>
        <select value={mode} onChange={(e) => setMode(e.target.value as IngestionMode)}>
          <option value="reference">Reference only</option>
          <option value="cached">Cached copy in R2</option>
          {isIIIF && <option value="iiif_reuse">Reuse detected IIIF</option>}
        </select>
      </label>

      {mode !== "iiif_reuse" && candidates.length > 0 && (
        <>
          <div className="muted">Choose one or more images:</div>
          <div className="thumbs">
            {candidates.slice(0, 18).map((url) => (
              <label key={url}>
                <input
                  type="checkbox"
                  checked={selected.includes(url)}
                  onChange={() => toggle(url)}
                />
                <img src={url} alt="" />
              </label>
            ))}
          </div>
        </>
      )}

      <div className="row">
        <button disabled={busy} onClick={addSelected}>
          {busy ? "Adding…" : "Add to library"}
        </button>
        <button
          className="ghost"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          Options
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {ok && <div className="alert ok">{ok}</div>}
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<React.StrictMode><Popup /></React.StrictMode>);
