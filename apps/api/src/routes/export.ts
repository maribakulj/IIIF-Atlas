/**
 * Bulk export. One endpoint, three formats:
 *
 *  - `json`: compact Item[] array, same shape the API returns elsewhere
 *  - `csv` : flat CSV, one row per item, with the core provenance +
 *           lifecycle fields. Tags are `;`-joined.
 *  - `ris` : RFC-free RIS tagged format — Zotero imports it natively.
 *           We use type ART (artwork) which Zotero maps to "Artwork".
 *
 * Scope: the caller's workspace, obeying the same q/mode/tag/rights
 * filters as the list endpoint. Up to 5000 rows in one shot; larger
 * corpora should paginate via offset/limit on /api/items itself and
 * concatenate client-side.
 */

import type { Item } from "@iiif-atlas/shared";
import { requireAuth } from "../auth.js";
import { mapItem } from "../db.js";
import type { ItemRow } from "../db.js";
import type { Env } from "../env.js";
import { badRequest } from "../errors.js";

const EXPORT_MAX = 5000;

export async function exportItems(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  const q = url.searchParams.get("q");
  const mode = url.searchParams.get("mode");
  const tag = url.searchParams.get("tag");
  const rights = url.searchParams.get("rights");

  if (format !== "json" && format !== "csv" && format !== "ris") {
    throw badRequest("format must be json, csv, or ris");
  }

  const joins: string[] = [];
  const where: string[] = ["i.workspace_id = ?", "i.deleted_at IS NULL"];
  const binds: unknown[] = [auth.workspaceId];
  if (q) {
    const ftsQuery = q
      .replace(/["()*:]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `${t}*`)
      .join(" ");
    if (ftsQuery) {
      joins.push("INNER JOIN items_fts f ON f.item_id = i.id");
      where.push("items_fts MATCH ?");
      binds.push(ftsQuery);
    }
  }
  if (mode) {
    where.push("i.mode = ?");
    binds.push(mode);
  }
  if (rights) {
    where.push("i.rights = ?");
    binds.push(rights);
  }
  if (tag) {
    where.push(
      `EXISTS (SELECT 1 FROM item_tags it_f JOIN tags t_f ON t_f.id = it_f.tag_id
                WHERE it_f.item_id = i.id AND t_f.slug = ? AND t_f.workspace_id = i.workspace_id)`,
    );
    binds.push(tag);
  }

  const rows = await env.DB.prepare(
    `SELECT i.*, GROUP_CONCAT(DISTINCT t.slug) AS tag_slugs
       FROM items i
       ${joins.join(" ")}
       LEFT JOIN item_tags it ON it.item_id = i.id
       LEFT JOIN tags t ON t.id = it.tag_id
      WHERE ${where.join(" AND ")}
      GROUP BY i.id
      ORDER BY i.captured_at DESC
      LIMIT ?`,
  )
    .bind(...binds, EXPORT_MAX)
    .all<ItemRow>();

  const items = (rows.results ?? []).map((r) => mapItem(r, env.PUBLIC_BASE_URL));

  const filename = `iiif-atlas-export-${new Date().toISOString().slice(0, 10)}.${format}`;
  const headers: HeadersInit = {
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };

  if (format === "json") {
    return new Response(JSON.stringify({ items }, null, 2), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
  if (format === "csv") {
    return new Response(toCsv(items), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  }
  return new Response(toRis(items), {
    headers: { ...headers, "Content-Type": "application/x-research-info-systems; charset=utf-8" },
  });
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(items: Item[]): string {
  const cols = [
    "id",
    "slug",
    "title",
    "description",
    "mode",
    "status",
    "source_page_url",
    "source_image_url",
    "source_manifest_url",
    "manifest_url",
    "captured_at",
    "width",
    "height",
    "mime_type",
    "rights",
    "tags",
    "region_xywh",
  ];
  const header = cols.join(",");
  const body = items.map((it) =>
    [
      it.id,
      it.slug,
      it.title,
      it.description,
      it.mode,
      it.status,
      it.sourcePageUrl,
      it.sourceImageUrl,
      it.sourceManifestUrl,
      it.manifestUrl,
      it.capturedAt,
      it.width,
      it.height,
      it.mimeType,
      it.rights,
      it.tags.join(";"),
      it.regionXywh,
    ]
      .map(csvEscape)
      .join(","),
  );
  return `${header}\n${body.join("\n")}\n`;
}

function toRis(items: Item[]): string {
  // RIS uses CRLF line endings and a blank line between records. We pick
  // `ART` (artwork) as the reference type since IIIF captures are by
  // definition visual — Zotero maps ART to its "Artwork" item type.
  const parts: string[] = [];
  for (const it of items) {
    const lines: string[] = [];
    lines.push("TY  - ART");
    if (it.title) lines.push(`TI  - ${it.title}`);
    if (it.description) lines.push(`AB  - ${it.description}`);
    if (it.sourcePageUrl) lines.push(`UR  - ${it.sourcePageUrl}`);
    if (it.manifestUrl) lines.push(`L1  - ${it.manifestUrl}`); // link to manifest
    if (it.sourceImageUrl) lines.push(`L2  - ${it.sourceImageUrl}`);
    if (it.capturedAt) lines.push(`Y1  - ${it.capturedAt.slice(0, 10).replace(/-/g, "/")}`);
    if (it.rights) lines.push(`CR  - ${it.rights}`);
    for (const tag of it.tags) lines.push(`KW  - ${tag}`);
    lines.push("ER  - ");
    parts.push(lines.join("\r\n"));
  }
  return `${parts.join("\r\n\r\n")}\r\n`;
}
