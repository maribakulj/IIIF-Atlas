import type {
  GenerateManifestResponse,
  ItemPatch,
  ItemResponse,
  ListItemsResponse,
} from "@iiif-atlas/shared";
import { requireAuth, requireWriter } from "../auth.js";
import { mapItem } from "../db.js";
import type { ItemRow } from "../db.js";
import type { Env } from "../env.js";
import { badRequest, notFound } from "../errors.js";
import { buildManifestForItem } from "../iiif-builder.js";

export async function listItems(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
  const q = url.searchParams.get("q");
  const mode = url.searchParams.get("mode");

  const where: string[] = ["workspace_id = ?"];
  const binds: unknown[] = [auth.workspaceId];
  if (q) {
    where.push("(title LIKE ? OR description LIKE ? OR source_page_title LIKE ?)");
    const like = `%${q}%`;
    binds.push(like, like, like);
  }
  if (mode) {
    where.push("mode = ?");
    binds.push(mode);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM items ${whereSql}`)
    .bind(...binds)
    .first<{ c: number }>();
  const total = totalRow?.c ?? 0;

  const rows = await env.DB.prepare(
    `SELECT * FROM items ${whereSql} ORDER BY captured_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<ItemRow>();

  const payload: ListItemsResponse = {
    items: (rows.results ?? []).map((r) => mapItem(r, env.PUBLIC_BASE_URL)),
    total,
    limit,
    offset,
  };
  return Response.json(payload);
}

export async function getItem(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  const row = await env.DB.prepare(
    `SELECT * FROM items WHERE (id = ? OR slug = ?) AND workspace_id = ?`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<ItemRow>();
  if (!row) throw notFound();
  const payload: ItemResponse = { item: mapItem(row, env.PUBLIC_BASE_URL) };
  return Response.json(payload);
}

export async function patchItem(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const body = (await req.json().catch(() => null)) as ItemPatch | null;
  if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");

  const row = await env.DB.prepare(
    `SELECT * FROM items WHERE (id = ? OR slug = ?) AND workspace_id = ?`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<ItemRow>();
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
  if (body.metadata !== undefined) {
    sets.push("metadata_json = ?");
    binds.push(body.metadata === null ? null : JSON.stringify(body.metadata));
  }
  if (body.mode !== undefined) {
    if (!["reference", "cached", "iiif_reuse"].includes(body.mode)) {
      throw badRequest("Invalid mode");
    }
    sets.push("mode = ?");
    binds.push(body.mode);
  }
  if (sets.length === 0) throw badRequest("No fields to update");
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  // Invalidate cached manifest so it gets regenerated next time.
  sets.push("manifest_json = NULL");

  await env.DB.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds, row.id)
    .run();

  const updated = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
    .bind(row.id)
    .first<ItemRow>();
  if (!updated) throw notFound();
  const payload: ItemResponse = { item: mapItem(updated, env.PUBLIC_BASE_URL) };
  return Response.json(payload);
}

export async function generateManifest(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const row = await env.DB.prepare(
    `SELECT * FROM items WHERE (id = ? OR slug = ?) AND workspace_id = ?`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<ItemRow>();
  if (!row) throw notFound();

  const item = mapItem(row, env.PUBLIC_BASE_URL);
  const manifest = await buildManifestForItem(env, item);

  await env.DB.prepare(
    `UPDATE items
     SET manifest_json = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`,
  )
    .bind(JSON.stringify(manifest), row.id)
    .run();

  const refreshed = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
    .bind(row.id)
    .first<ItemRow>();
  const updated = mapItem(refreshed!, env.PUBLIC_BASE_URL);
  const payload: GenerateManifestResponse = {
    item: updated,
    manifestUrl: updated.manifestUrl!,
  };
  return Response.json(payload);
}
