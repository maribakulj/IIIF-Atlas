import type { Item } from "@iiif-atlas/shared";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { MiradorViewer } from "../components/MiradorViewer.js";
import { ModeBadge } from "../components/ModeBadge.js";
import { StatusBadge } from "../components/StatusBadge.js";

export function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rights, setRights] = useState("");
  const [newTag, setNewTag] = useState("");

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    api
      .getItem(id)
      .then((res) => {
        if (!active) return;
        setItem(res.item);
        setTitle(res.item.title ?? "");
        setDescription(res.item.description ?? "");
        setRights(res.item.rights ?? "");
      })
      .catch((err) => active && setError(String(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  async function save() {
    if (!item) return;
    setSaving(true);
    try {
      const res = await api.patchItem(item.id, {
        title,
        description,
        rights: rights.trim() || null,
      });
      setItem(res.item);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function addTag(e: React.FormEvent) {
    e.preventDefault();
    if (!item || !newTag.trim()) return;
    try {
      await api.addItemTag(item.id, { name: newTag.trim() });
      setNewTag("");
      const fresh = await api.getItem(item.id);
      setItem(fresh.item);
    } catch (err) {
      setError(String(err));
    }
  }

  async function removeTag(slug: string) {
    if (!item) return;
    try {
      await api.removeItemTag(item.id, slug);
      const fresh = await api.getItem(item.id);
      setItem(fresh.item);
    } catch (err) {
      setError(String(err));
    }
  }

  async function regenerate() {
    if (!item) return;
    setSaving(true);
    try {
      const res = await api.generateManifest(item.id);
      setItem(res.item);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function retry() {
    if (!item) return;
    setSaving(true);
    try {
      const res = await api.retryItem(item.id);
      setItem(res.item);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <div className="alert error">{error}</div>;
  if (!item) return <p>Not found.</p>;

  return (
    <div className="item-page">
      <header className="page-header">
        <h1>{item.title ?? item.sourcePageTitle ?? item.slug}</h1>
        <div className="row-between">
          <span className="row" style={{ gap: 6 }}>
            <ModeBadge mode={item.mode} />
            <StatusBadge status={item.status} />
          </span>
          <small className="muted">Captured {new Date(item.capturedAt).toLocaleString()}</small>
        </div>
        {item.status === "failed" && (
          <div className="alert error">
            <strong>Ingestion failed.</strong> {item.errorMessage ?? "Unknown error."}{" "}
            <button className="btn btn-xs" onClick={retry} disabled={saving}>
              Retry
            </button>
          </div>
        )}
        {item.status === "processing" && (
          <div className="alert">Processing… reload in a moment.</div>
        )}
      </header>

      <div className="split">
        <div className="card">
          <h3>Metadata</h3>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Description
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Rights (URL or SPDX)
            <input
              value={rights}
              onChange={(e) => setRights(e.target.value)}
              placeholder="https://creativecommons.org/licenses/by/4.0/"
            />
          </label>
          <div className="row">
            <button className="btn" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn btn-ghost" disabled={saving} onClick={regenerate}>
              Regenerate manifest
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ marginBottom: 4 }}>Tags</label>
            <div className="facets">
              {item.tags.map((t) => (
                <span key={t} className="chip chip-active">
                  {t}
                  <button
                    type="button"
                    className="chip-x"
                    onClick={() => removeTag(t)}
                    aria-label={`Remove tag ${t}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {item.tags.length === 0 && <span className="muted">No tags yet.</span>}
            </div>
            <form onSubmit={addTag} className="row">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Add tag…"
              />
              <button className="btn btn-xs" disabled={!newTag.trim()}>
                Add
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <h3>Provenance</h3>
          <dl>
            <dt>Source page</dt>
            <dd>
              {item.sourcePageUrl ? (
                <a href={item.sourcePageUrl} target="_blank" rel="noreferrer">
                  {item.sourcePageUrl}
                </a>
              ) : (
                "—"
              )}
            </dd>
            <dt>Source image</dt>
            <dd>
              {item.sourceImageUrl ? (
                <a href={item.sourceImageUrl} target="_blank" rel="noreferrer">
                  {item.sourceImageUrl}
                </a>
              ) : (
                "—"
              )}
            </dd>
            <dt>Source manifest</dt>
            <dd>
              {item.sourceManifestUrl ? (
                <a href={item.sourceManifestUrl} target="_blank" rel="noreferrer">
                  {item.sourceManifestUrl}
                </a>
              ) : (
                "—"
              )}
            </dd>
            <dt>Public manifest</dt>
            <dd>
              {item.manifestUrl ? (
                <a href={item.manifestUrl} target="_blank" rel="noreferrer">
                  {item.manifestUrl}
                </a>
              ) : (
                "—"
              )}
            </dd>
            {item.regionXywh && (
              <>
                <dt>Region (xywh)</dt>
                <dd>
                  <code>{item.regionXywh}</code>
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {item.manifestUrl && (
        <section className="card">
          <h3>Viewer</h3>
          <MiradorViewer manifestUrl={item.manifestUrl} />
        </section>
      )}
    </div>
  );
}
