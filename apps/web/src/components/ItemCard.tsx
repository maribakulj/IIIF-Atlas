import { Link } from "react-router-dom";
import type { Item } from "@iiif-atlas/shared";
import { ModeBadge } from "./ModeBadge.js";
import { API_BASE_URL } from "../lib/config.js";

export function ItemCard({ item }: { item: Item }) {
  const thumb =
    item.r2Key
      ? `${API_BASE_URL.replace(/\/$/, "")}/r2/${item.r2Key}`
      : item.sourceImageUrl ?? undefined;

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
          <ModeBadge mode={item.mode} />
          <small>{new Date(item.capturedAt).toLocaleDateString()}</small>
        </div>
      </div>
    </Link>
  );
}
