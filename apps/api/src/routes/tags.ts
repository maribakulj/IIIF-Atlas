import type { AddTagRequest, ListTagsResponse, Tag } from "@iiif-atlas/shared";
import { requireAuth, requireWriter } from "../auth.js";
import type { Env } from "../env.js";
import { badRequest, notFound } from "../errors.js";
import { slugify, ulid } from "../slug.js";

interface TagRow {
  id: string;
  name: string;
  slug: string;
}

function mapTag(row: TagRow & { item_count?: number }): Tag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    itemCount: row.item_count,
  };
}

export async function listTags(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  // Single-pass count: LEFT JOIN item_tags+items so tags with zero live
  // items still appear with item_count = 0, and deleted items are
  // excluded from the count without a per-tag subquery.
  const rows = await env.DB.prepare(
    `SELECT t.id, t.name, t.slug,
            COUNT(i.id) AS item_count
       FROM tags t
       LEFT JOIN item_tags it ON it.tag_id = t.id
       LEFT JOIN items i     ON i.id = it.item_id AND i.deleted_at IS NULL
      WHERE t.workspace_id = ?
      GROUP BY t.id
      ORDER BY t.name COLLATE NOCASE ASC
      LIMIT 2000`,
  )
    .bind(auth.workspaceId)
    .all<TagRow & { item_count: number }>();
  const payload: ListTagsResponse = {
    tags: (rows.results ?? []).map(mapTag),
  };
  return Response.json(payload);
}

/**
 * Attach a tag to an item. Tag is auto-created (upserted by slug) in the
 * workspace if it doesn't yet exist. Idempotent: posting the same tag
 * twice is not an error.
 */
export async function addTagToItem(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const body = (await req.json().catch(() => null)) as AddTagRequest | null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    throw badRequest("name is required");
  }

  const item = await env.DB.prepare(
    `SELECT id FROM items WHERE (id = ? OR slug = ?) AND workspace_id = ? AND deleted_at IS NULL`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<{ id: string }>();
  if (!item) throw notFound();

  const name = body.name.trim().slice(0, 64);
  const slug = slugify(name, "tag");

  let tag = await env.DB.prepare(
    `SELECT id, name, slug FROM tags WHERE workspace_id = ? AND slug = ?`,
  )
    .bind(auth.workspaceId, slug)
    .first<TagRow>();
  if (!tag) {
    const id = ulid();
    await env.DB.prepare(`INSERT INTO tags (id, workspace_id, name, slug) VALUES (?,?,?,?)`)
      .bind(id, auth.workspaceId, name, slug)
      .run();
    tag = { id, name, slug };
  }

  await env.DB.prepare(`INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?,?)`)
    .bind(item.id, tag.id)
    .run();

  return Response.json({ tag: mapTag(tag) }, { status: 201 });
}

export async function removeTagFromItem(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);

  const item = await env.DB.prepare(
    `SELECT id FROM items WHERE (id = ? OR slug = ?) AND workspace_id = ? AND deleted_at IS NULL`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<{ id: string }>();
  if (!item) throw notFound();

  const tag = await env.DB.prepare(`SELECT id FROM tags WHERE workspace_id = ? AND slug = ?`)
    .bind(auth.workspaceId, params.tag ?? "")
    .first<{ id: string }>();
  if (!tag) throw notFound("Tag not found");

  await env.DB.prepare(`DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?`)
    .bind(item.id, tag.id)
    .run();
  return new Response(null, { status: 204 });
}
