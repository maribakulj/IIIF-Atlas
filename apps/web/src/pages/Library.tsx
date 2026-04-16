import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import type { IngestionMode, Item } from "@iiif-atlas/shared";
import { ItemCard } from "../components/ItemCard.js";

export function Library() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<IngestionMode | "">("");
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .listItems({ q: q || undefined, mode: mode || undefined, limit: 100 })
      .then((res) => {
        if (!active) return;
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [q, mode]);

  return (
    <div>
      <header className="page-header">
        <h1>Library</h1>
        <p className="muted">{total} items</p>
      </header>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search title, description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={mode} onChange={(e) => setMode(e.target.value as IngestionMode | "")}>
          <option value="">All modes</option>
          <option value="reference">Reference</option>
          <option value="cached">Cached</option>
          <option value="iiif_reuse">IIIF reuse</option>
        </select>
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading && <p>Loading…</p>}

      <div className="grid">
        {items.map((it) => <ItemCard key={it.id} item={it} />)}
      </div>
    </div>
  );
}
