/**
 * GET /api/trash — list soft-deleted items and collections for the
 * current workspace, newest tombstones first. No paging yet; the
 * dashboard surfaces at most a few dozen rows.
 */

import { requireAuth } from "../auth.js";
import { mapCollection, mapItem } from "../db.js";
import type { CollectionRow, ItemRow } from "../db.js";
import type { Env } from "../env.js";

export async function listTrash(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  const items = await env.DB.prepare(
    `SELECT * FROM items
      WHERE workspace_id = ? AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
      LIMIT 500`,
  )
    .bind(auth.workspaceId)
    .all<ItemRow & { deleted_at: string }>();
  const cols = await env.DB.prepare(
    `SELECT * FROM collections
      WHERE workspace_id = ? AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC
      LIMIT 500`,
  )
    .bind(auth.workspaceId)
    .all<CollectionRow & { deleted_at: string }>();

  return Response.json({
    items: (items.results ?? []).map((r) => ({
      ...mapItem(r, env.PUBLIC_BASE_URL),
      deletedAt: r.deleted_at,
    })),
    collections: (cols.results ?? []).map((r) => ({
      ...mapCollection(r),
      deletedAt: r.deleted_at,
    })),
  });
}
