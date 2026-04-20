import type { Facets, IngestionMode, Item, ItemSort, Tag } from "@iiif-atlas/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { ItemCard } from "../components/ItemCard.js";
import { getApiKey } from "../lib/auth.js";
import { API_BASE_URL } from "../lib/config.js";

/**
 * Fetch an export and hand it to the browser as a download. Going through
 * fetch() + Blob (instead of a plain <a href>) keeps the API key in the
 * Authorization header where it belongs — nothing leaks to URL logs.
 */
async function downloadExport(format: "json" | "csv" | "ris", q: string, tag: string) {
  const key = getApiKey();
  const p = new URLSearchParams({ format });
  if (q) p.set("q", q);
  if (tag) p.set("tag", tag);
  const res = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/api/export/items?${p.toString()}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const filename = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? `iiif-atlas-export.${format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function Library() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<IngestionMode | "">("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<ItemSort>("captured_at_desc");
  const [items, setItems] = useState<Item[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      api.listItems({
        q: q || undefined,
        mode: mode || undefined,
        tag: tag || undefined,
        sort,
        facets: true,
        limit: 100,
      }),
      api.listTags(),
    ])
      .then(([res, tagsRes]) => {
        if (!active) return;
        setItems(res.items);
        setTotal(res.total);
        setFacets(res.facets ?? null);
        setAllTags(tagsRes.tags);
        setError(null);
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [q, mode, tag, sort]);

  const [exporting, setExporting] = useState<null | string>(null);
  async function onExport(format: "json" | "csv" | "ris") {
    setExporting(format);
    try {
      await downloadExport(format, q, tag);
    } catch (err) {
      setError(String(err));
    } finally {
      setExporting(null);
    }
  }

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
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.name} {t.itemCount ? `(${t.itemCount})` : ""}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as ItemSort)}>
          <option value="captured_at_desc">Newest</option>
          <option value="captured_at_asc">Oldest</option>
          <option value="title_asc">Title A–Z</option>
        </select>
      </div>

      {facets && facets.tag.length > 0 && !tag && (
        <div className="facets">
          <span className="muted">Popular tags:</span>
          {facets.tag.slice(0, 10).map((f) => (
            <button key={f.value} className="chip" onClick={() => setTag(f.value)} type="button">
              {f.value} <small>({f.count})</small>
            </button>
          ))}
        </div>
      )}
      {tag && (
        <div className="facets">
          <span className="chip chip-active">
            tag: {tag}{" "}
            <button className="chip-x" onClick={() => setTag("")} type="button">
              ×
            </button>
          </span>
        </div>
      )}

      <div className="row" style={{ margin: "8px 0" }}>
        <span className="muted">Export:</span>
        <button
          type="button"
          className="btn btn-xs btn-ghost"
          disabled={exporting !== null}
          onClick={() => onExport("json")}
        >
          {exporting === "json" ? "Exporting…" : "JSON"}
        </button>
        <button
          type="button"
          className="btn btn-xs btn-ghost"
          disabled={exporting !== null}
          onClick={() => onExport("csv")}
        >
          {exporting === "csv" ? "Exporting…" : "CSV"}
        </button>
        <button
          type="button"
          className="btn btn-xs btn-ghost"
          disabled={exporting !== null}
          onClick={() => onExport("ris")}
        >
          {exporting === "ris" ? "Exporting…" : "RIS (Zotero)"}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading && <p>Loading…</p>}

      <div className="grid">
        {items.map((it) => (
          <ItemCard key={it.id} item={it} />
        ))}
      </div>
    </div>
  );
}
