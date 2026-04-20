import type { Collection, Item, ShareTokenSummary, ShareTokenWithSecret } from "@iiif-atlas/shared";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { API_BASE_URL } from "../lib/config.js";

export function CollectionEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shares, setShares] = useState<ShareTokenSummary[]>([]);
  const [justCreatedShare, setJustCreatedShare] = useState<ShareTokenWithSecret | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([id ? api.getCollection(id) : Promise.resolve(null), api.listItems({ limit: 200 })])
      .then(([col, items]) => {
        if (!active) return;
        setAllItems(items.items);
        if (col) {
          setCollection(col.collection);
          setTitle(col.collection.title);
          setDescription(col.collection.description ?? "");
          setIsPublic(col.collection.isPublic);
          setSelected((col.collection.items ?? []).map((i) => i.id));
          // Load any existing share tokens for this collection.
          api
            .listShares({ resourceType: "collection", resourceId: col.collection.id })
            .then((r) => {
              if (active) setShares(r.shares);
            })
            .catch(() => {
              /* non-fatal */
            });
        }
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  const publicUrl = useMemo(() => {
    if (!collection) return null;
    return `${API_BASE_URL.replace(/\/$/, "")}/iiif/collections/${collection.slug}`;
  }, [collection]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (collection) {
        const res = await api.updateCollection(collection.id, {
          title,
          description,
          isPublic,
          itemIds: selected,
        });
        setCollection(res.collection);
      } else {
        const res = await api.createCollection({
          title: title || "Untitled",
          description,
          isPublic,
          itemIds: selected,
        });
        navigate(`/collections/${res.collection.id}`, { replace: true });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function toggle(itemId: string) {
    setSelected((prev) =>
      prev.includes(itemId) ? prev.filter((x) => x !== itemId) : [...prev, itemId],
    );
  }

  async function mintShare() {
    if (!collection) return;
    try {
      const res = await api.createShare({
        resourceType: "collection",
        resourceId: collection.id,
        role: "viewer",
      });
      setJustCreatedShare(res.share);
      const listed = await api.listShares({
        resourceType: "collection",
        resourceId: collection.id,
      });
      setShares(listed.shares);
    } catch (err) {
      setError(String(err));
    }
  }

  async function revokeShare(id: string) {
    try {
      await api.revokeShare(id);
      setShares((prev) =>
        prev.map((s) => (s.id === id ? { ...s, revokedAt: new Date().toISOString() } : s)),
      );
    } catch (err) {
      setError(String(err));
    }
  }

  function shareUrlFor(secret: string): string {
    return `${window.location.origin}/shared/c/${secret}`;
  }

  function move(itemId: string, dir: -1 | 1) {
    setSelected((prev) => {
      const i = prev.indexOf(itemId);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = prev.slice();
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <header className="page-header">
        <h1>{collection ? "Edit collection" : "New collection"}</h1>
        {publicUrl && (
          <p className="muted">
            Public IIIF Collection URL:{" "}
            <a href={publicUrl} target="_blank" rel="noreferrer">
              {publicUrl}
            </a>
          </p>
        )}
      </header>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Description
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          Publish as public IIIF Collection
        </label>
        <div className="row">
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {collection && (
        <div className="card">
          <h3>Share links</h3>
          <p className="muted">
            Viewer tokens open a read-only page on your web app — no sign-up required. Only
            workspace members see them here.
          </p>
          {justCreatedShare && (
            <div className="alert ok">
              <p>
                <strong>New share token (shown once):</strong>
              </p>
              <code style={{ wordBreak: "break-all" }}>{shareUrlFor(justCreatedShare.secret)}</code>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => {
                    navigator.clipboard
                      ?.writeText(shareUrlFor(justCreatedShare.secret))
                      .catch(() => {
                        /* noop */
                      });
                  }}
                >
                  Copy URL
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => setJustCreatedShare(null)}
                >
                  Done
                </button>
              </div>
            </div>
          )}
          {shares.length > 0 && (
            <ul className="list">
              {shares.map((s) => (
                <li key={s.id}>
                  <code>{s.prefix}…</code>
                  <span className="muted"> · {s.role}</span>
                  {s.revokedAt ? (
                    <span className="muted"> · revoked</span>
                  ) : (
                    <>
                      <span className="muted"> · {new Date(s.createdAt).toLocaleDateString()}</span>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        style={{ marginLeft: 8 }}
                        onClick={() => revokeShare(s.id)}
                      >
                        Revoke
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={mintShare}>
              Create viewer share link
            </button>
          </div>
        </div>
      )}

      <div className="split">
        <div className="card">
          <h3>Items in collection ({selected.length})</h3>
          {selected.length === 0 && <p className="muted">No items yet.</p>}
          <ol className="selected-list">
            {selected.map((id, idx) => {
              const it = allItems.find((i) => i.id === id);
              if (!it) return null;
              return (
                <li key={id}>
                  <span>{it.title ?? it.slug}</span>
                  <span className="row">
                    <button
                      className="btn btn-xs"
                      onClick={() => move(id, -1)}
                      disabled={idx === 0}
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-xs"
                      onClick={() => move(id, 1)}
                      disabled={idx === selected.length - 1}
                    >
                      ↓
                    </button>
                    <button className="btn btn-xs btn-ghost" onClick={() => toggle(id)}>
                      Remove
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="card">
          <h3>Library</h3>
          <ul className="selectable-list">
            {allItems.map((it) => (
              <li key={it.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(it.id)}
                    onChange={() => toggle(it.id)}
                  />
                  {it.title ?? it.sourcePageTitle ?? it.slug}
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
