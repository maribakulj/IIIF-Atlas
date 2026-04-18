import { useState } from "react";
import { ApiError, api } from "../api/client.js";
import { setApiKey } from "../lib/auth.js";

type Mode = "paste" | "dev-signup";

export function SignIn() {
  const [mode, setMode] = useState<Mode>("dev-signup");

  return (
    <div className="signin-shell">
      <div className="card signin-card">
        <h1>Sign in to IIIF Atlas</h1>
        <p className="muted">
          IIIF Atlas authenticates with API keys (Bearer tokens). In dev you can create one in a
          single click; otherwise paste a key minted via the API.
        </p>

        <div className="row">
          <button
            className={mode === "dev-signup" ? "btn" : "btn btn-ghost"}
            onClick={() => setMode("dev-signup")}
          >
            Quick dev sign-up
          </button>
          <button
            className={mode === "paste" ? "btn" : "btn btn-ghost"}
            onClick={() => setMode("paste")}
          >
            I have an API key
          </button>
        </div>

        {mode === "dev-signup" ? <DevSignupForm /> : <PasteKeyForm />}
      </div>
    </div>
  );
}

function DevSignupForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.devSignup({
        email,
        displayName: name || undefined,
        workspaceName: workspace || undefined,
      });
      setApiKey(res.apiKey.secret);
      // Hard reload to refresh derived state.
      window.location.replace("/");
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 403
          ? "Dev sign-up is disabled in this environment. Paste an API key instead."
          : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        Email
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </label>
      <label>
        Name (optional)
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Workspace name (optional)
        <input value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn" disabled={busy}>
          {busy ? "Creating…" : "Create workspace + API key"}
        </button>
      </div>
      {error && <div className="alert error">{error}</div>}
    </form>
  );
}

function PasteKeyForm() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    setApiKey(key.trim());
    try {
      await api.me();
      window.location.replace("/");
    } catch (err) {
      setApiKey(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label>
        API key (starts with <code>iia_</code>)
        <input required value={key} onChange={(e) => setKey(e.target.value)} placeholder="iia_…" />
      </label>
      <div className="row">
        <button className="btn" disabled={busy}>
          {busy ? "Verifying…" : "Sign in"}
        </button>
      </div>
      {error && <div className="alert error">{error}</div>}
    </form>
  );
}
