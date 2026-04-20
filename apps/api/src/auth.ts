/**
 * Auth: bearer-API-key authentication.
 *
 * - Raw key format: `iia_` + 32 random crockford-base32 chars (~ 160 bits).
 * - At rest: only the SHA-256 hex digest is stored, plus the first 12 chars
 *   as `prefix` for human display ("iia_AB12CD34…").
 * - One key authenticates a (user, workspace) pair. To act on a different
 *   workspace, mint another key. This keeps the request-time scoping
 *   trivial: every authenticated request has exactly one workspace_id.
 * - `last_used_at` is bumped on every successful auth.
 */

import type { Env } from "./env.js";
import { HttpError } from "./errors.js";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  apiKeyId: string;
  role: "owner" | "editor" | "viewer";
  scopes: string[] | null;
}

const KEY_PREFIX = "iia_";
const PREFIX_DISPLAY_LEN = 12;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateApiKey(): { raw: string; hash: Promise<string>; prefix: string } {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let body = "";
  for (let i = 0; i < bytes.length; i++) {
    body += ALPHABET[(bytes[i] ?? 0) % 32];
    body += ALPHABET[((bytes[i] ?? 0) >> 3) % 32];
  }
  body = body.slice(0, 32);
  const raw = `${KEY_PREFIX}${body}`;
  const prefix = raw.slice(0, PREFIX_DISPLAY_LEN);
  return { raw, hash: hashApiKey(raw), prefix };
}

export async function hashApiKey(raw: string): Promise<string> {
  const enc = new TextEncoder().encode(raw);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractBearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^bearer\s+(.+)$/i.exec(h.trim());
  return m && m[1] ? m[1].trim() : null;
}

interface ApiKeyRow {
  id: string;
  user_id: string;
  workspace_id: string;
  scopes: string | null;
  revoked_at: string | null;
  role: "owner" | "editor" | "viewer" | null;
}

/** Look up the bearer token; returns null if no/invalid auth. */
export async function authenticate(req: Request, env: Env): Promise<AuthContext | null> {
  const raw = extractBearer(req);
  if (!raw) return null;
  if (!raw.startsWith(KEY_PREFIX)) return null;
  const hash = await hashApiKey(raw);

  const row = await env.DB.prepare(
    `SELECT k.id, k.user_id, k.workspace_id, k.scopes, k.revoked_at,
            wm.role AS role
       FROM api_keys k
  LEFT JOIN workspace_members wm
         ON wm.workspace_id = k.workspace_id AND wm.user_id = k.user_id
      WHERE k.hashed_key = ?`,
  )
    .bind(hash)
    .first<ApiKeyRow>();

  if (!row) return null;
  if (row.revoked_at) return null;

  // Best-effort touch of last_used_at. Don't fail the request if it errors.
  env.DB.prepare(
    `UPDATE api_keys
        SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
  )
    .bind(row.id)
    .run()
    .catch(() => {
      /* noop */
    });

  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    apiKeyId: row.id,
    role: row.role ?? "viewer",
    scopes: row.scopes ? (JSON.parse(row.scopes) as string[]) : null,
  };
}

export async function requireAuth(req: Request, env: Env): Promise<AuthContext> {
  const ctx = await authenticate(req, env);
  if (!ctx) throw new HttpError(401, "unauthorized", "Missing or invalid API key");
  return ctx;
}

export function requireWriter(ctx: AuthContext): void {
  if (ctx.role === "viewer") {
    throw new HttpError(403, "forbidden", "Viewer role cannot mutate");
  }
}
