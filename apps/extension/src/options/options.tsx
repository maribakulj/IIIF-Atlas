import type { IngestionMode } from "@iiif-atlas/shared";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getSettings, setApiBase, setApiKey, setDomainPresets } from "../lib/api.js";

function Options() {
  const [apiBase, setApiBaseLocal] = useState("");
  const [apiKey, setApiKeyLocal] = useState("");
  const [presetsText, setPresetsText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setApiBaseLocal(s.apiBase);
      setApiKeyLocal(s.apiKey ?? "");
      setPresetsText(JSON.stringify(s.domainPresets, null, 2));
    });
  }, []);

  async function save() {
    setError(null);
    const presets: Record<string, IngestionMode> = {};
    try {
      const parsed = JSON.parse(presetsText || "{}");
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          if (v === "reference" || v === "cached" || v === "iiif_reuse") {
            presets[k.toLowerCase()] = v;
          } else {
            throw new Error(
              `Unknown mode "${String(v)}" for "${k}". Use reference, cached, or iiif_reuse.`,
            );
          }
        }
      }
    } catch (err) {
      setError(`Presets JSON invalid: ${(err as Error).message}`);
      return;
    }
    try {
      await Promise.all([
        setApiBase(apiBase.trim()),
        setApiKey(apiKey.trim()),
        setDomainPresets(presets),
      ]);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <h1>IIIF Atlas — Options</h1>
      <p className="muted">
        Captures are POSTed to <code>&lt;API&gt;/api/captures</code> with your API key as a Bearer
        token. Mint keys from the web app's Settings page.
      </p>

      <label>API base URL</label>
      <input
        value={apiBase}
        onChange={(e) => setApiBaseLocal(e.target.value)}
        placeholder="https://api.iiif-atlas.example.com"
      />

      <label style={{ marginTop: 12, display: "block" }}>API key</label>
      <input value={apiKey} onChange={(e) => setApiKeyLocal(e.target.value)} placeholder="iia_…" />

      <label style={{ marginTop: 16, display: "block" }}>Per-domain ingestion defaults</label>
      <p className="muted" style={{ marginTop: 0 }}>
        JSON map of hostname → mode. Hostnames inherit from their parent (a preset on{" "}
        <code>example.org</code> applies to <code>sub.example.org</code>).
      </p>
      <textarea
        rows={6}
        value={presetsText}
        onChange={(e) => setPresetsText(e.target.value)}
        style={{
          width: "100%",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
        }}
      />
      {error && <div style={{ color: "#ff6b6b", marginTop: 6 }}>{error}</div>}

      <div style={{ marginTop: 12 }}>
        <button onClick={save}>Save</button>
        {saved && (
          <span className="ok" style={{ marginLeft: 8 }}>
            Saved
          </span>
        )}
      </div>

      <h3 style={{ marginTop: 24 }}>Keyboard</h3>
      <p className="muted">
        <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> ( <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>{" "}
        on macOS) captures the primary image of the current page. Rebind in{" "}
        <a href="chrome://extensions/shortcuts" target="_blank" rel="noreferrer">
          chrome://extensions/shortcuts
        </a>
        .
      </p>
    </div>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <Options />
    </React.StrictMode>,
  );
