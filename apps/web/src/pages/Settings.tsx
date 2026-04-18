import type { ApiKeySummary, ApiKeyWithSecret, MeResponse } from "@iiif-atlas/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { setApiKey } from "../lib/auth.js";
import { API_BASE_URL } from "../lib/config.js";

export function Settings() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiKeyWithSecret | null>(null);

  async function refresh() {
    try {
      const [meRes, keysRes] = await Promise.all([api.me(), api.listApiKeys()]);
      setMe(meRes);
      setKeys(keysRes.keys);
    } catch (err) {
      setError(String(err));
    }
  }

  // refresh is stable for the component lifetime; intentional empty deps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    refresh();
  }, []);

  async function createKey() {
    const name = window.prompt("Name for the new API key:", "Browser");
    if (!name) return;
    try {
      const res = await api.createApiKey({ name });
      setCreated(res.key);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this API key? This cannot be undone.")) return;
    try {
      await api.revokeApiKey(id);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  function signOut() {
    setApiKey(null);
  }

  return (
    <div>
      <header className="page-header">
        <h1>Settings</h1>
      </header>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <h3>Account</h3>
        {me ? (
          <>
            <p>
              <strong>{me.user.email}</strong>
              {me.user.displayName ? ` · ${me.user.displayName}` : ""}
            </p>
            <p className="muted">
              Active workspace: {me.activeWorkspace?.name ?? "—"} ({me.role ?? "no role"})
            </p>
            <button className="btn btn-ghost" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </div>

      <div className="card">
        <h3>API endpoint</h3>
        <p>
          <code>{API_BASE_URL}</code>
        </p>
        <p className="muted">
          Configure via the <code>VITE_API_BASE_URL</code> environment variable at build time.
        </p>
      </div>

      <div className="card">
        <h3>API keys</h3>
        <p className="muted">
          Use one API key per device. Paste an extension key into the IIIF Atlas extension's options
          page.
        </p>
        {created && (
          <div className="alert ok">
            <p>
              <strong>New key created — save it now, it will not be shown again:</strong>
            </p>
            <code style={{ wordBreak: "break-all" }}>{created.secret}</code>
            <div className="row">
              <button className="btn btn-xs" onClick={() => setCreated(null)}>
                Done
              </button>
            </div>
          </div>
        )}
        <table className="keys-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>
                  <code>{k.prefix}…</code>
                </td>
                <td>{new Date(k.createdAt).toLocaleDateString()}</td>
                <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                <td>
                  {k.revokedAt ? (
                    <span className="muted">revoked</span>
                  ) : (
                    <button className="btn btn-xs btn-ghost" onClick={() => revoke(k.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button className="btn" onClick={createKey}>
            New API key
          </button>
        </div>
      </div>

      <div className="card">
        <h3>IIIF endpoints</h3>
        <ul>
          <li>
            Manifest: <code>{API_BASE_URL}/iiif/manifests/:slug</code>
          </li>
          <li>
            Collection: <code>{API_BASE_URL}/iiif/collections/:slug</code>
          </li>
        </ul>
      </div>
    </div>
  );
}
