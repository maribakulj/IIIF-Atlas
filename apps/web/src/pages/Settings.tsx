import { API_BASE_URL } from "../lib/config.js";

export function Settings() {
  return (
    <div>
      <header className="page-header">
        <h1>Settings</h1>
      </header>

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
        <h3>Extension</h3>
        <p>
          Install the browser extension from the <code>apps/extension/dist</code> build. Open its
          options page to set the API endpoint it should POST captures to.
        </p>
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
