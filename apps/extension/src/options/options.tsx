import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getSettings, setApiBase, setApiKey } from "../lib/api.js";

function Options() {
  const [apiBase, setApiBaseLocal] = useState("");
  const [apiKey, setApiKeyLocal] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setApiBaseLocal(s.apiBase);
      setApiKeyLocal(s.apiKey ?? "");
    });
  }, []);

  async function save() {
    await Promise.all([setApiBase(apiBase.trim()), setApiKey(apiKey.trim())]);
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
      <button onClick={save}>Save</button>
      {saved && (
        <span className="ok" style={{ marginLeft: 8 }}>
          Saved
        </span>
      )}
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
