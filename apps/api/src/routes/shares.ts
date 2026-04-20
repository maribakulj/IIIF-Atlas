/**
 * Share tokens — pseudonymous, scoped, revocable URLs.
 *
 *  POST   /api/shares                  mint a token for one collection or item
 *  GET    /api/shares                  list the caller's workspace tokens
 *  DELETE /api/shares/:id              revoke
 *  GET    /api/shares/:token           PUBLIC — resolve a raw token into a
 *                                      read-only view of the resource
 *
 * Tokens are formatted `iia_share_` + 32 crockford chars; only the
 * SHA-256 hex digest is stored at rest.
 */

import type {
  Collection,
  CreateShareRequest,
  CreateShareResponse,
  Item,
  ListSharesResponse,
  ShareResolveResponse,
  ShareResourceType,
  ShareRole,
  ShareTokenSummary,
  ShareTokenWithSecret,
} from "@iiif-atlas/shared";
import { hashApiKey, requireAuth, requireWriter } from "../auth.js";
import { mapCollection, mapItem } from "../db.js";
import type { CollectionRow, ItemRow } from "../db.js";
import type { Env } from "../env.js";
import { HttpError, badRequest, notFound } from "../errors.js";
import { ulid } from "../slug.js";

const SHARE_PREFIX = "iia_share_";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function mintRawShareToken(): { raw: string; prefix: string } {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let body = "";
  for (let i = 0; i < bytes.length; i++) {
    body += ALPHABET[(bytes[i] ?? 0) % 32];
    body += ALPHABET[((bytes[i] ?? 0) >> 3) % 32];
  }
  body = body.slice(0, 32);
  const raw = `${SHARE_PREFIX}${body}`;
  return { raw, prefix: raw.slice(0, 16) };
}

interface ShareRow {
  id: string;
  workspace_id: string;
  prefix: string;
  resource_type: ShareResourceType;
  resource_id: string;
  role: ShareRole;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

function mapShareSummary(row: ShareRow): ShareTokenSummary {
  return {
    id: row.id,
    prefix: row.prefix,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    role: row.role,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

/** Ensure the caller can share the target resource (must belong to the same workspace). */
async function assertResourceOwnership(
  env: Env,
  workspaceId: string,
  resourceType: ShareResourceType,
  resourceId: string,
): Promise<void> {
  const table = resourceType === "collection" ? "collections" : "items";
  const row = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ? AND workspace_id = ?`)
    .bind(resourceId, workspaceId)
    .first<{ id: string }>();
  if (!row) throw notFound(`${resourceType} not found in this workspace`);
}

export async function createShare(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const body = (await req.json().catch(() => null)) as CreateShareRequest | null;
  if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");
  if (body.resourceType !== "collection" && body.resourceType !== "item") {
    throw badRequest("resourceType must be 'collection' or 'item'");
  }
  if (!body.resourceId || typeof body.resourceId !== "string") {
    throw badRequest("resourceId is required");
  }
  const role: ShareRole = body.role ?? "viewer";
  if (role !== "viewer" && role !== "editor") throw badRequest("role must be viewer or editor");

  await assertResourceOwnership(env, auth.workspaceId, body.resourceType, body.resourceId);

  const { raw, prefix } = mintRawShareToken();
  const hash = await hashApiKey(raw);
  const id = ulid();
  await env.DB.prepare(
    `INSERT INTO share_tokens
       (id, workspace_id, token_hash, prefix, resource_type, resource_id, role, created_by, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      auth.workspaceId,
      hash,
      prefix,
      body.resourceType,
      body.resourceId,
      role,
      auth.userId,
      body.expiresAt ?? null,
    )
    .run();

  const row = await env.DB.prepare(`SELECT * FROM share_tokens WHERE id = ?`)
    .bind(id)
    .first<ShareRow>();
  const payload: ShareTokenWithSecret = { ...mapShareSummary(row!), secret: raw };
  const res: CreateShareResponse = { share: payload };
  return Response.json(res, { status: 201 });
}

export async function listShares(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  const url = new URL(req.url);
  const resourceType = url.searchParams.get("resourceType") as ShareResourceType | null;
  const resourceId = url.searchParams.get("resourceId");
  const where: string[] = ["workspace_id = ?"];
  const binds: unknown[] = [auth.workspaceId];
  if (resourceType) {
    where.push("resource_type = ?");
    binds.push(resourceType);
  }
  if (resourceId) {
    where.push("resource_id = ?");
    binds.push(resourceId);
  }
  const rows = await env.DB.prepare(
    `SELECT * FROM share_tokens WHERE ${where.join(" AND ")} ORDER BY created_at DESC`,
  )
    .bind(...binds)
    .all<ShareRow>();
  const payload: ListSharesResponse = {
    shares: (rows.results ?? []).map(mapShareSummary),
  };
  return Response.json(payload);
}

export async function revokeShare(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  const res = await env.DB.prepare(
    `UPDATE share_tokens
        SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`,
  )
    .bind(params.id, auth.workspaceId)
    .run();
  if (res.meta.changes === 0) throw notFound("Share not found or already revoked");
  return new Response(null, { status: 204 });
}

/**
 * GET /api/shares/:token — public.
 *
 * Resolves a raw share token into a read-only snapshot of the underlying
 * collection or item, including the items the collection contains.
 * Expired / revoked tokens return 404 rather than 410 so we don't
 * confirm the token ever existed.
 */
export async function resolveShare(
  _req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const token = params.token ?? "";
  if (!token.startsWith(SHARE_PREFIX)) throw notFound();
  const hash = await hashApiKey(token);
  const row = await env.DB.prepare(
    `SELECT s.*, w.name AS workspace_name
       FROM share_tokens s
       JOIN workspaces w ON w.id = s.workspace_id
      WHERE s.token_hash = ?`,
  )
    .bind(hash)
    .first<ShareRow & { workspace_name: string }>();
  if (!row) throw notFound();
  if (row.revoked_at) throw notFound();
  if (row.expires_at && row.expires_at < new Date().toISOString()) throw notFound();

  const payload: ShareResolveResponse = {
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    role: row.role,
    workspaceName: row.workspace_name,
  };

  if (row.resource_type === "collection") {
    const col = await env.DB.prepare(`SELECT * FROM collections WHERE id = ?`)
      .bind(row.resource_id)
      .first<CollectionRow>();
    if (!col) throw notFound();
    const items = await env.DB.prepare(
      `SELECT i.*, GROUP_CONCAT(DISTINCT t.slug) AS tag_slugs
         FROM items i
         INNER JOIN collection_items ci ON ci.item_id = i.id
         LEFT JOIN item_tags it ON it.item_id = i.id
         LEFT JOIN tags t ON t.id = it.tag_id
        WHERE ci.collection_id = ?
        GROUP BY i.id
        ORDER BY ci.position ASC`,
    )
      .bind(col.id)
      .all<ItemRow>();
    const mapped = (items.results ?? []).map((r) => mapItem(r, env.PUBLIC_BASE_URL));
    payload.collection = mapCollection(col, mapped.length, mapped) satisfies Collection;
  } else {
    const it = await env.DB.prepare(
      `SELECT i.*, GROUP_CONCAT(DISTINCT t.slug) AS tag_slugs
         FROM items i
         LEFT JOIN item_tags it ON it.item_id = i.id
         LEFT JOIN tags t ON t.id = it.tag_id
        WHERE i.id = ?
        GROUP BY i.id`,
    )
      .bind(row.resource_id)
      .first<ItemRow>();
    if (!it) throw notFound();
    payload.item = mapItem(it, env.PUBLIC_BASE_URL) satisfies Item;
  }

  return Response.json(payload);
}

export { HttpError };
