import { mapCollection, mapItem } from "../db.js";
import type { CollectionRow, ItemRow } from "../db.js";
import type { Env } from "../env.js";
import { notFound } from "../errors.js";
import { buildCollectionManifest, buildManifestForItem } from "../iiif-builder.js";

const JSON_LD_HEADERS: HeadersInit = {
  "Content-Type": 'application/ld+json;profile="http://iiif.io/api/presentation/3/context.json"',
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};

export async function getManifestBySlug(
  _req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT * FROM items WHERE (manifest_slug = ? OR slug = ?) AND deleted_at IS NULL`,
  )
    .bind(params.slug, params.slug)
    .first<ItemRow>();
  if (!row) throw notFound("Manifest not found");

  // Serve cached JSON if available.
  if (row.manifest_json) {
    return new Response(row.manifest_json, { status: 200, headers: JSON_LD_HEADERS });
  }

  const item = mapItem(row, env.PUBLIC_BASE_URL);
  const manifest = await buildManifestForItem(env, item);
  const body = JSON.stringify(manifest);
  // Best-effort cache write (don't fail the request if it errors).
  try {
    await env.DB.prepare(
      `UPDATE items SET manifest_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    )
      .bind(body, row.id)
      .run();
  } catch {
    /* noop */
  }
  return new Response(body, { status: 200, headers: JSON_LD_HEADERS });
}

export async function getCollectionBySlug(
  _req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT * FROM collections WHERE slug = ? AND deleted_at IS NULL`,
  )
    .bind(params.slug)
    .first<CollectionRow>();
  // Return 404 for both missing AND private collections so we don't leak
  // the existence of a slug to anonymous callers.
  if (!row || !row.is_public) throw notFound("Collection not found");
  const items = await env.DB.prepare(
    `SELECT i.* FROM items i
     INNER JOIN collection_items ci ON ci.item_id = i.id
     WHERE ci.collection_id = ? AND i.deleted_at IS NULL
     ORDER BY ci.position ASC`,
  )
    .bind(row.id)
    .all<ItemRow>();
  const mapped = (items.results ?? []).map((r) => mapItem(r, env.PUBLIC_BASE_URL));
  const manifest = buildCollectionManifest(env, mapCollection(row, mapped.length), mapped);
  return new Response(JSON.stringify(manifest), { status: 200, headers: JSON_LD_HEADERS });
}
