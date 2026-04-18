import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { getApiKey, onApiKeyChange } from "./lib/auth.js";
import { CollectionEditor } from "./pages/CollectionEditor.js";
import { Dashboard } from "./pages/Dashboard.js";
import { ItemPage } from "./pages/ItemPage.js";
import { Library } from "./pages/Library.js";
import { Settings } from "./pages/Settings.js";
import { SignIn } from "./pages/SignIn.js";

export function App() {
  const [apiKey, setKey] = useState<string | null>(getApiKey());
  useEffect(() => onApiKeyChange(setKey), []);

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
