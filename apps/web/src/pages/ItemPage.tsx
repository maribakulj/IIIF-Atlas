import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client.js";
import type { Item } from "@iiif-atlas/shared";
import { ModeBadge } from "../components/ModeBadge.js";
import { MiradorViewer } from "../components/MiradorViewer.js";

export function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

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
      const res = await api.patchItem(item.id, { title, description });
      setItem(res.item);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
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

  if (loading) return <p>Loading…</p>;
  if (error) return <div className="alert error">{error}</div>;
  if (!item) return <p>Not found.</p>;

  return (
    <div className="item-page">
      <header className="page-header">
        <h1>{item.title ?? item.sourcePageTitle ?? item.slug}</h1>
        <div className="row-between">
          <ModeBadge mode={item.mode} />
          <small className="muted">Captured {new Date(item.capturedAt).toLocaleString()}</small>
        </div>
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
          <div className="row">
            <button className="btn" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn btn-ghost" disabled={saving} onClick={regenerate}>
              Regenerate manifest
            </button>
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
              ) : "—"}
            </dd>
            <dt>Source image</dt>
            <dd>
              {item.sourceImageUrl ? (
                <a href={item.sourceImageUrl} target="_blank" rel="noreferrer">
                  {item.sourceImageUrl}
                </a>
              ) : "—"}
            </dd>
            <dt>Source manifest</dt>
            <dd>
              {item.sourceManifestUrl ? (
                <a href={item.sourceManifestUrl} target="_blank" rel="noreferrer">
                  {item.sourceManifestUrl}
                </a>
              ) : "—"}
            </dd>
            <dt>Public manifest</dt>
            <dd>
              {item.manifestUrl ? (
                <a href={item.manifestUrl} target="_blank" rel="noreferrer">
                  {item.manifestUrl}
                </a>
              ) : "—"}
            </dd>
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
