/**
 * Audit log. Append-only record of every mutation we care about:
 *  - `item.create`, `item.update`, `item.delete`, `item.restore`
 *  - `item.ingest.ready`, `item.ingest.failed` (system actor)
 *  - `collection.create`, `collection.update`, `collection.delete`, `collection.restore`
 *  - `annotation.create`, `annotation.update`, `annotation.delete`
 *  - `share.create`, `share.revoke`
 *  - `apikey.create`, `apikey.revoke`
 *
 * Failures are swallowed — an audit hiccup must never prevent the
 * mutation itself.
 *
 * `ctx` shapes:
 *  - `null`               — neither workspace nor actor known (rare)
 *  - `{workspaceId, userId}` — user-driven mutation
 *  - `{workspaceId, userId: null}` — system actor (e.g. queue ingest)
 */

import type { Env } from "./env.js";
import { ulid } from "./slug.js";

export interface AuditContext {
  workspaceId: string;
  userId: string | null;
}

export async function recordAudit(
  env: Env,
  ctx: AuditContext | null,
  verb: string,
  subjectType: string,
  subjectId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log
         (id, workspace_id, actor_user_id, verb, subject_type, subject_id, details_json)
       VALUES (?,?,?,?,?,?,?)`,
    )
      .bind(
        ulid(),
        ctx?.workspaceId ?? null,
        ctx?.userId ?? null,
        verb,
        subjectType,
        subjectId,
        details ? JSON.stringify(details) : null,
      )
      .run();
  } catch (err) {
    console.warn("[audit] record failed", err);
  }
}
