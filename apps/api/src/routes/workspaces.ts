/**
 * GET /api/workspaces/current/usage
 *
 * Cheap rollup of workspace-scoped counts + total R2 bytes for the assets
 * referenced by live items. Used by the Settings screen and for future
 * quota/billing UX.
 */

import { requireAuth } from "../auth.js";
import type { Env } from "../env.js";

export async function getWorkspaceUsage(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  const wid = auth.workspaceId;

  const [items, trashItems, collections, trashCollections, annotations, shares, bytes] =
    await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS c FROM items WHERE workspace_id = ? AND deleted_at IS NULL`,
      )
        .bind(wid)
        .first<{ c: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS c FROM items WHERE workspace_id = ? AND deleted_at IS NOT NULL`,
      )
        .bind(wid)
        .first<{ c: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS c FROM collections WHERE workspace_id = ? AND deleted_at IS NULL`,
      )
        .bind(wid)
        .first<{ c: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS c FROM collections WHERE workspace_id = ? AND deleted_at IS NOT NULL`,
      )
        .bind(wid)
        .first<{ c: number }>(),
      env.DB.prepare(`SELECT COUNT(*) AS c FROM annotations WHERE workspace_id = ?`)
        .bind(wid)
        .first<{ c: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS c FROM share_tokens WHERE workspace_id = ? AND revoked_at IS NULL`,
      )
        .bind(wid)
        .first<{ c: number }>(),
      // Sum bytes of the assets referenced by this workspace's live items.
      // DISTINCT because multiple items can share one deduped asset.
      env.DB.prepare(
        `SELECT COALESCE(SUM(a.byte_size), 0) AS b
           FROM assets a
          WHERE a.sha256 IN (
            SELECT DISTINCT asset_sha256 FROM items
             WHERE workspace_id = ? AND deleted_at IS NULL AND asset_sha256 IS NOT NULL
          )`,
      )
        .bind(wid)
        .first<{ b: number }>(),
    ]);

  return Response.json({
    workspaceId: wid,
    items: items?.c ?? 0,
    trashedItems: trashItems?.c ?? 0,
    collections: collections?.c ?? 0,
    trashedCollections: trashCollections?.c ?? 0,
    annotations: annotations?.c ?? 0,
    activeShares: shares?.c ?? 0,
    assetBytes: bytes?.b ?? 0,
  });
}
