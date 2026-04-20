import { useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { getApiKey, onApiKeyChange } from "./lib/auth.js";
import { CollectionEditor } from "./pages/CollectionEditor.js";
import { Dashboard } from "./pages/Dashboard.js";
import { ItemPage } from "./pages/ItemPage.js";
import { Library } from "./pages/Library.js";
import { Settings } from "./pages/Settings.js";
import { SharedCollection } from "./pages/SharedCollection.js";
import { SignIn } from "./pages/SignIn.js";

export function App() {
  const [apiKey, setKey] = useState<string | null>(getApiKey());
  const location = useLocation();
  useEffect(() => onApiKeyChange(setKey), []);

  // `/shared/*` is the only route that should render to unauthenticated
  // visitors — it's the whole point of share tokens. Everything else
  // falls back to the sign-in screen.
  if (location.pathname.startsWith("/shared/")) {
    return (
      <Routes>
        <Route path="/shared/c/:token" element={<SharedCollection />} />
        <Route
          path="*"
          element={
            <div className="signin-shell">
              <div className="card signin-card">
                <h1>Not a share link</h1>
              </div>
            </div>
          }
        />
      </Routes>
    );
  }
  if (!apiKey) return <SignIn />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/library" element={<Library />} />
        <Route path="/items/:id" element={<ItemPage />} />
        <Route path="/collections/new" element={<CollectionEditor />} />
        <Route path="/collections/:id" element={<CollectionEditor />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<div className="card">Not found</div>} />
      </Routes>
    </Layout>
  );
}
