import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getApiBase, setApiBase } from "../lib/api.js";

function Options() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getApiBase().then(setValue);
  }, []);

  async function save() {
    await setApiBase(value.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <h1>IIIF Atlas — Options</h1>
      <p className="muted">
        Point the extension at your Cloudflare Workers API. Captures are POSTed
        to <code>&lt;API&gt;/api/captures</code>.
      </p>
      <label>API base URL</label>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://api.iiif-atlas.example.com" />
      <button onClick={save}>Save</button>
      {saved && <span className="ok" style={{ marginLeft: 8 }}>Saved</span>}
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<React.StrictMode><Options /></React.StrictMode>);
