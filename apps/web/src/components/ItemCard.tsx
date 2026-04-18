import type { Item } from "@iiif-atlas/shared";
import { Link } from "react-router-dom";
import { API_BASE_URL } from "../lib/config.js";
import { ModeBadge } from "./ModeBadge.js";
import { StatusBadge } from "./StatusBadge.js";

export function ItemCard({ item }: { item: Item }) {
  const thumb = item.r2Key
    ? `${API_BASE_URL.replace(/\/$/, "")}/r2/${item.r2Key}`
    : (item.sourceImageUrl ?? undefined);

  return (
    <Link to={`/items/${item.id}`} className="item-card">
      <div className="item-thumb">
        {thumb ? (
          <img src={thumb} alt={item.title ?? "Item"} loading="lazy" />
        ) : (
          <div className="item-thumb-placeholder">No preview</div>
        )}
      </div>
      <div className="item-body">
        <div className="item-title">{item.title ?? item.sourcePageTitle ?? item.slug}</div>
        <div className="item-meta">
          <span className="row" style={{ gap: 4 }}>
            <ModeBadge mode={item.mode} />
            <StatusBadge status={item.status} />
          </span>
          <small>{new Date(item.capturedAt).toLocaleDateString()}</small>
        </div>
      </div>
    </Link>
  );
}
