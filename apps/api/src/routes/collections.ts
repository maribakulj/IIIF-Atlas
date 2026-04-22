import type {
  CollectionCreate,
  CollectionResponse,
  ListCollectionsResponse,
} from "@iiif-atlas/shared";
import { recordActivity } from "../activity.js";
import { recordAudit } from "../audit.js";
import { requireAuth, requireWriter } from "../auth.js";
import { mapCollection, mapItem } from "../db.js";
import type { CollectionRow, ItemRow } from "../db.js";
import type { Env } from "../env.js";
import { badRequest, notFound } from "../errors.js";
import { revokeSharesFor } from "../shares-revoke.js";
import { shortId, slugify, ulid } from "../slug.js";

export async function listCollections(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  const rows = await env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
       FROM collections c
      WHERE c.workspace_id = ? AND c.deleted_at IS NULL
      ORDER BY c.updated_at DESC`,
  )
    .bind(auth.workspaceId)
    .all<CollectionRow & { item_count: number }>();

  const payload: ListCollectionsResponse = {
    collections: (rows.results ?? []).map((r) => mapCollection(r, r.item_count ?? 0)),
  };
  return Response.json(payload);
}

export async function createCollection(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const body = (await req.json().catch(() => null)) as CollectionCreate | null;
  if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");
  if (!body.title || typeof body.title !== "string") throw badRequest("title is required");

  const id = ulid();
  const slug = `${slugify(body.title, "collection")}-${shortId(6)}`;

  await env.DB.prepare(
    `INSERT INTO collections (id, slug, title, description, is_public, workspace_id)
     VALUES (?,?,?,?,?,?)`,
  )
    .bind(
      id,
      slug,
      body.title,
      body.description ?? null,
      body.isPublic === false ? 0 : 1,
      auth.workspaceId,
    )
    .run();

  if (body.itemIds && body.itemIds.length > 0) {
    // Only attach items that belong to the same workspace.
    const place = body.itemIds.map(() => "?").join(",");
    const owned = await env.DB.prepare(
      `SELECT id FROM items WHERE workspace_id = ? AND id IN (${place})`,
    )
      .bind(auth.workspaceId, ...body.itemIds)
      .all<{ id: string }>();
    const ownedIds = new Set((owned.results ?? []).map((r) => r.id));
    const accepted = body.itemIds.filter((iid) => ownedIds.has(iid));
    if (accepted.length > 0) {
      const stmts = accepted.map((itemId, idx) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO collection_items (collection_id, item_id, position) VALUES (?,?,?)`,
        ).bind(id, itemId, idx),
      );
      await env.DB.batch(stmts);
    }
  }

  if (body.isPublic !== false) {
    await recordActivity(env, "Create", "Collection", slug);
  }
  await recordAudit(
    env,
    { workspaceId: auth.workspaceId, userId: auth.userId },
    "collection.create",
    "collection",
    id,
    { slug, isPublic: body.isPublic !== false },
  );
  return getCollectionResponse(env, id, 201);
}

export async function getCollection(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  const row = await env.DB.prepare(
    `SELECT * FROM collections WHERE (id = ? OR slug = ?) AND workspace_id = ? AND deleted_at IS NULL`,
  )
    .bind(params.id, params.id, auth.workspaceId)
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
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const body = (await req.json().catch(() => null)) as
    | (Partial<CollectionCreate> & { itemIds?: string[] })
    | null;
  if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");

  const row = await env.DB.prepare(
    `SELECT * FROM collections WHERE (id = ? OR slug = ?) AND workspace_id = ? AND deleted_at IS NULL`,
  )
    .bind(params.id, params.id, auth.workspaceId)
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
      const place = body.itemIds.map(() => "?").join(",");
      const owned = await env.DB.prepare(
        `SELECT id FROM items WHERE workspace_id = ? AND id IN (${place})`,
      )
        .bind(auth.workspaceId, ...body.itemIds)
        .all<{ id: string }>();
      const ownedIds = new Set((owned.results ?? []).map((r) => r.id));
      const accepted = body.itemIds.filter((iid) => ownedIds.has(iid));
      if (accepted.length > 0) {
        const stmts = accepted.map((itemId, idx) =>
          env.DB.prepare(
            `INSERT OR IGNORE INTO collection_items (collection_id, item_id, position) VALUES (?,?,?)`,
          ).bind(row.id, itemId, idx),
        );
        await env.DB.batch(stmts);
      }
    }
  }

  // Report the update on the public feed iff the collection is currently
  // public. Collections flipping to private produce no event.
  const effectivePublic = body.isPublic === undefined ? Boolean(row.is_public) : body.isPublic;
  if (effectivePublic) {
    await recordActivity(env, "Update", "Collection", row.slug);
  }
  await recordAudit(
    env,
    { workspaceId: auth.workspaceId, userId: auth.userId },
    "collection.update",
    "collection",
    row.id,
    { fields: Object.keys(body) },
  );

  return getCollectionResponse(env, row.id, 200);
}

export async function deleteCollection(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const row = await env.DB.prepare(
    `SELECT id, slug, is_public FROM collections
      WHERE (id = ? OR slug = ?) AND workspace_id = ? AND deleted_at IS NULL`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<{ id: string; slug: string; is_public: number }>();
  if (!row) throw notFound();

  await env.DB.prepare(
    `UPDATE collections
        SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
  )
    .bind(row.id)
    .run();
  const revoked = await revokeSharesFor(env, "collection", row.id);
  if (row.is_public) {
    await recordActivity(env, "Delete", "Collection", row.slug);
  }
  await recordAudit(
    env,
    { workspaceId: auth.workspaceId, userId: auth.userId },
    "collection.delete",
    "collection",
    row.id,
    revoked > 0 ? { revokedShares: revoked } : undefined,
  );
  return new Response(null, { status: 204 });
}

export async function restoreCollection(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const row = await env.DB.prepare(
    `SELECT id, slug, is_public FROM collections
      WHERE (id = ? OR slug = ?) AND workspace_id = ? AND deleted_at IS NOT NULL`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<{ id: string; slug: string; is_public: number }>();
  if (!row) throw notFound("Collection not in trash");

  await env.DB.prepare(
    `UPDATE collections SET deleted_at = NULL,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
  )
    .bind(row.id)
    .run();
  if (row.is_public) {
    await recordActivity(env, "Create", "Collection", row.slug);
  }
  await recordAudit(
    env,
    { workspaceId: auth.workspaceId, userId: auth.userId },
    "collection.restore",
    "collection",
    row.id,
  );
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
     WHERE ci.collection_id = ? AND i.deleted_at IS NULL
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
