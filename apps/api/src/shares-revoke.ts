/**
 * Bulk-revoke share tokens targeting a given resource. Called from the
 * soft-delete paths so a deleted item/collection can no longer be
 * resolved via a pre-existing share URL.
 *
 * Idempotent: tokens that are already revoked stay revoked.
 */

import type { Env } from "./env.js";

export async function revokeSharesFor(
  env: Env,
  resourceType: "item" | "collection",
  resourceId: string,
): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE share_tokens
        SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE resource_type = ? AND resource_id = ? AND revoked_at IS NULL`,
  )
    .bind(resourceType, resourceId)
    .run();
  return res.meta.changes ?? 0;
}
