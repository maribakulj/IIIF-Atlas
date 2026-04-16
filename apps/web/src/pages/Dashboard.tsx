import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import type { Collection, Item } from "@iiif-atlas/shared";
import { ItemCard } from "../components/ItemCard.js";

export function Dashboard() {
  const [items, setItems] = useState<Item[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.listItems({ limit: 8 }), api.listCollections()])
      .then(([itemsRes, collectionsRes]) => {
        if (!active) return;
        setItems(itemsRes.items);
        setTotal(itemsRes.total);
        setCollections(collectionsRes.collections);
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <header className="page-header">
        <h1>Dashboard</h1>
        <p className="muted">
          Capture images from the web with the browser extension, or add IIIF
          resources directly from the library.
        </p>
      </header>

      {error && <div className="alert error">{error}</div>}

      <section className="card">
        <div className="row-between">
          <h2>Recent items</h2>
          <Link to="/library" className="btn btn-ghost">View all ({total})</Link>
        </div>
        {loading ? (
          <p>Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">No items yet. Install the extension and clip your first image.</p>
        ) : (
          <div className="grid">
            {items.map((it) => <ItemCard key={it.id} item={it} />)}
          </div>
        )}
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Collections</h2>
          <Link to="/collections/new" className="btn">New collection</Link>
        </div>
        {collections.length === 0 ? (
          <p className="muted">No collections yet.</p>
        ) : (
          <ul className="list">
            {collections.map((c) => (
              <li key={c.id}>
                <Link to={`/collections/${c.id}`}>
                  <strong>{c.title}</strong>
                </Link>
                <span className="muted"> · {c.itemCount ?? 0} items</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
