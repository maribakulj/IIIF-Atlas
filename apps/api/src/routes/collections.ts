import type {
  CollectionCreate,
  CollectionResponse,
  ListCollectionsResponse,
} from "@iiif-atlas/shared";
import { mapCollection, mapItem } from "../db.js";
import type { CollectionRow, ItemRow } from "../db.js";
import type { Env } from "../env.js";
import { badRequest, notFound } from "../errors.js";
import { shortId, slugify, ulid } from "../slug.js";

export async function listCollections(_req: Request, env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
     FROM collections c ORDER BY c.updated_at DESC`,
  ).all<CollectionRow & { item_count: number }>();

  const payload: ListCollectionsResponse = {
    collections: (rows.results ?? []).map((r) => mapCollection(r, r.item_count ?? 0)),
  };
  return Response.json(payload);
}

export async function createCollection(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as CollectionCreate | null;
  if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");
  if (!body.title || typeof body.title !== "string") throw badRequest("title is required");

  const id = ulid();
  const slug = `${slugify(body.title, "collection")}-${shortId(6)}`;

  await env.DB.prepare(
    `INSERT INTO collections (id, slug, title, description, is_public) VALUES (?,?,?,?,?)`,
  )
    .bind(id, slug, body.title, body.description ?? null, body.isPublic === false ? 0 : 1)
    .run();

  if (body.itemIds && body.itemIds.length > 0) {
    const stmts = body.itemIds.map((itemId, idx) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO collection_items (collection_id, item_id, position) VALUES (?,?,?)`,
      ).bind(id, itemId, idx),
    );
    await env.DB.batch(stmts);
  }

  return getCollectionResponse(env, id, 201);
}

export async function getCollection(
  _req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const row = await env.DB.prepare(`SELECT * FROM collections WHERE id = ? OR slug = ?`)
    .bind(params.id, params.id)
    .first<CollectionRow>();
  if (!row) throw notFound();
  return getCollectionResponse(env, row.id, 200);
}

export async function updateCollection(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | (Partial<CollectionCreate> & { itemIds?: string[] })
    | null;
  if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");

  const row = await env.DB.prepare(`SELECT * FROM collections WHERE id = ? OR slug = ?`)
    .bind(params.id, params.id)
    .first<CollectionRow>();
  if (!row) throw notFound();

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.title !== undefined) {
    sets.push("title = ?");
    binds.push(body.title);
  }
  if (body.description !== undefined) {
    sets.push("description = ?");
    binds.push(body.description);
  }
  if (body.isPublic !== undefined) {
    sets.push("is_public = ?");
    binds.push(body.isPublic ? 1 : 0);
  }
  if (sets.length) {
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    await env.DB.prepare(`UPDATE collections SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds, row.id)
      .run();
  }

  if (Array.isArray(body.itemIds)) {
    await env.DB.prepare(`DELETE FROM collection_items WHERE collection_id = ?`).bind(row.id).run();
    if (body.itemIds.length > 0) {
      const stmts = body.itemIds.map((itemId, idx) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO collection_items (collection_id, item_id, position) VALUES (?,?,?)`,
        ).bind(row.id, itemId, idx),
      );
      await env.DB.batch(stmts);
    }
  }

  return getCollectionResponse(env, row.id, 200);
}

async function getCollectionResponse(env: Env, id: string, status: number): Promise<Response> {
  const row = await env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
    .bind(id)
    .first<CollectionRow>();
  if (!row) throw notFound();
  const items = await env.DB.prepare(
    `SELECT i.* FROM items i
     INNER JOIN collection_items ci ON ci.item_id = i.id
     WHERE ci.collection_id = ?
     ORDER BY ci.position ASC`,
  )
    .bind(id)
    .all<ItemRow>();
  const mapped = (items.results ?? []).map((r) => mapItem(r, env.PUBLIC_BASE_URL));
  const payload: CollectionResponse = {
    collection: mapCollection(row, mapped.length, mapped),
  };
  return Response.json(payload, { status });
}
