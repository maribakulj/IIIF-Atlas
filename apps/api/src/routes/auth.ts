import type {
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  DevSignupRequest,
  DevSignupResponse,
  ListApiKeysResponse,
  MeResponse,
  WorkspaceMembership,
  WorkspaceRole,
} from "@iiif-atlas/shared";
import { generateApiKey, requireAuth } from "../auth.js";
import type { Env } from "../env.js";
import { HttpError, badRequest, notFound } from "../errors.js";
import { shortId, slugify, ulid } from "../slug.js";

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  owner_user_id: string;
  created_at: string;
}

interface ApiKeySummaryRow {
  id: string;
  name: string;
  prefix: string;
  workspace_id: string;
  scopes: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

function mapUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

function mapWorkspace(row: WorkspaceRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
  };
}

function mapApiKeySummary(row: ApiKeySummaryRow) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    workspaceId: row.workspace_id,
    scopes: row.scopes ? (JSON.parse(row.scopes) as string[]) : null,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * Bootstrap a fresh user, default workspace, ownership, and a first API
 * key — gated by `ALLOW_DEV_SIGNUP=true`. Idempotent on email: if the
 * user already exists, we mint a *new* API key in their default workspace
 * but return the existing identities, so a dev can rotate locally.
 */
export async function devSignup(req: Request, env: Env): Promise<Response> {
  if (env.ALLOW_DEV_SIGNUP !== "true") {
    throw new HttpError(403, "forbidden", "Dev signup disabled in this environment");
  }
  const body = (await req.json().catch(() => null)) as DevSignupRequest | null;
  if (!body || !body.email || typeof body.email !== "string") {
    throw badRequest("email is required");
  }
  const email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest("email is not valid");
  }

  // Find or create the user.
  let user = await env.DB.prepare(`SELECT * FROM users WHERE email = ?`)
    .bind(email)
    .first<UserRow>();
  if (!user) {
    const id = ulid();
    await env.DB.prepare(`INSERT INTO users (id, email, display_name) VALUES (?,?,?)`)
      .bind(id, email, body.displayName ?? null)
      .run();
    user = (await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>())!;
  }

  // Find or create a workspace they own.
  let workspace = await env.DB.prepare(
    `SELECT w.* FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
      WHERE m.user_id = ? AND m.role = 'owner'
      ORDER BY w.created_at ASC LIMIT 1`,
  )
    .bind(user.id)
    .first<WorkspaceRow>();
  if (!workspace) {
    const id = ulid();
    const name = body.workspaceName?.trim() || `${user.display_name ?? user.email}'s workspace`;
    const slug = `${slugify(name, "workspace")}-${shortId(6)}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO workspaces (id, slug, name, owner_user_id) VALUES (?,?,?,?)`,
      ).bind(id, slug, name, user.id),
      env.DB.prepare(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)`,
      ).bind(id, user.id, "owner"),
    ]);
    workspace = (await env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
      .bind(id)
      .first<WorkspaceRow>())!;
  }

  const created = await mintApiKey(env, user.id, workspace.id, "Dev signup key");

  const payload: DevSignupResponse = {
    user: { id: user.id, email: user.email, displayName: user.display_name },
    workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
    apiKey: created,
  };
  return Response.json(payload, { status: 201 });
}

export async function me(req: Request, env: Env): Promise<Response> {
  const ctx = await requireAuth(req, env);

  const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(ctx.userId)
    .first<UserRow>();
  if (!user) throw notFound("User not found");

  const memberships = await env.DB.prepare(
    `SELECT w.id, w.slug, w.name, w.owner_user_id, w.created_at, m.role
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ?
      ORDER BY w.created_at ASC`,
  )
    .bind(ctx.userId)
    .all<WorkspaceRow & { role: WorkspaceRole }>();

  const mapped: WorkspaceMembership[] = (memberships.results ?? []).map((r) => ({
    workspace: mapWorkspace(r),
    role: r.role,
  }));
  const active = mapped.find((m) => m.workspace.id === ctx.workspaceId) ?? null;

  const payload: MeResponse = {
    user: mapUser(user),
    memberships: mapped,
    activeWorkspace: active?.workspace ?? null,
    role: active?.role ?? null,
  };
  return Response.json(payload);
}

export async function listApiKeys(req: Request, env: Env): Promise<Response> {
  const ctx = await requireAuth(req, env);
  const rows = await env.DB.prepare(
    `SELECT id, name, prefix, workspace_id, scopes, last_used_at, created_at, revoked_at
       FROM api_keys
      WHERE user_id = ?
      ORDER BY created_at DESC`,
  )
    .bind(ctx.userId)
    .all<ApiKeySummaryRow>();
  const payload: ListApiKeysResponse = {
    keys: (rows.results ?? []).map(mapApiKeySummary),
  };
  return Response.json(payload);
}

export async function createApiKey(req: Request, env: Env): Promise<Response> {
  const ctx = await requireAuth(req, env);
  const body = (await req.json().catch(() => null)) as CreateApiKeyRequest | null;
  if (!body || !body.name || typeof body.name !== "string") {
    throw badRequest("name is required");
  }

  const targetWorkspace = body.workspaceId ?? ctx.workspaceId;
  // The caller must be a member of the target workspace.
  const member = await env.DB.prepare(
    `SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?`,
  )
    .bind(targetWorkspace, ctx.userId)
    .first<{ 1: number }>();
  if (!member) throw new HttpError(403, "forbidden", "Not a member of that workspace");

  const created = await mintApiKey(
    env,
    ctx.userId,
    targetWorkspace,
    body.name,
    body.scopes ?? null,
  );
  const payload: CreateApiKeyResponse = { key: created };
  return Response.json(payload, { status: 201 });
}

export async function revokeApiKey(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const ctx = await requireAuth(req, env);
  const id = params.id;
  if (!id) throw notFound();

  const res = await env.DB.prepare(
    `UPDATE api_keys
        SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  )
    .bind(id, ctx.userId)
    .run();
  if (res.meta.changes === 0) throw notFound("API key not found or already revoked");
  return new Response(null, { status: 204 });
}

async function mintApiKey(
  env: Env,
  userId: string,
  workspaceId: string,
  name: string,
  scopes: string[] | null = null,
) {
  const { raw, hash, prefix } = generateApiKey();
  const id = ulid();
  await env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, workspace_id, name, prefix, hashed_key, scopes)
     VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(id, userId, workspaceId, name, prefix, await hash, scopes ? JSON.stringify(scopes) : null)
    .run();
  const row = await env.DB.prepare(
    `SELECT id, name, prefix, workspace_id, scopes, last_used_at, created_at, revoked_at
       FROM api_keys WHERE id = ?`,
  )
    .bind(id)
    .first<ApiKeySummaryRow>();
  if (!row) throw new Error("Failed to load created API key");
  return { ...mapApiKeySummary(row), secret: raw };
}
