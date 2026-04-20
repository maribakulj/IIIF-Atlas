import type { ShareResolveResponse } from "@iiif-atlas/shared";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, api } from "../api/client.js";
import { ItemCard } from "../components/ItemCard.js";

/**
 * Public read-only view for a collection share. Routed at
 * `/shared/c/:token`. This page does NOT require the visitor to have
 * their own API key — it uses the share token as the only credential
 * (resolved server-side via GET /api/shares/:token, no auth header).
 */
export function SharedCollection() {
  const { token } = useParams<{ token: string }>();
  const [res, setRes] = useState<ShareResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .resolveShare(token)
      .then((r) => {
        if (active) setRes(r);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(
          err instanceof ApiError && err.status === 404
            ? "This share link is invalid, expired, or has been revoked."
            : String(err),
        );
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (error) {
    return (
      <div className="signin-shell">
        <div className="card signin-card">
          <h1>Share unavailable</h1>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!res) return <p style={{ padding: 24 }}>Loading…</p>;
  if (res.resourceType !== "collection" || !res.collection) {
    return (
      <div className="signin-shell">
        <div className="card signin-card">
          <h1>Unsupported share type</h1>
          <p className="muted">
            This page only renders collection shares; the token points at a {res.resourceType}.
          </p>
        </div>
      </div>
    );
  }

  const c = res.collection;
  return (
    <div className="main" style={{ margin: "0 auto" }}>
      <header className="page-header">
        <small className="muted">
          Shared by {res.workspaceName} · {res.role}
        </small>
        <h1>{c.title}</h1>
        {c.description && <p className="muted">{c.description}</p>}
        <p className="muted">{c.itemCount ?? c.items?.length ?? 0} items</p>
      </header>
      <div className="grid">
        {(c.items ?? []).map((it) => (
          <ItemCard key={it.id} item={it} />
        ))}
      </div>
    </div>
  );
}
