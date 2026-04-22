/**
 * Annotations: IIIF Web Annotations stored one-per-row.
 *
 * Routes
 *  GET  /api/items/:id/annotations          workspace-scoped list (API shape)
 *  POST /api/items/:id/annotations          create
 *  PATCH  /api/annotations/:id              edit
 *  DELETE /api/annotations/:id              delete
 *  GET  /iiif/items/:slug/annotations       PUBLIC — IIIF AnnotationPage
 *
 * The public endpoint keys by the item's `manifest_slug` (which is also
 * the slug in the manifest URL). It returns every stored annotation for
 * that item; viewers see the body + xywh target. We deliberately don't
 * gate the page behind workspace auth: anyone holding the public manifest
 * URL already sees the image, and annotations round out that public view.
 * Private collections/items still aren't discoverable via their slug.
 */

import type {
  Annotation,
  AnnotationCreate,
  AnnotationMotivation,
  AnnotationPatch,
  AnnotationResponse,
  ListAnnotationsResponse,
} from "@iiif-atlas/shared";
import { recordAudit } from "../audit.js";
import { requireAuth, requireWriter } from "../auth.js";
import type { Env } from "../env.js";
import { badRequest, notFound } from "../errors.js";
import { ulid } from "../slug.js";

interface AnnotationRow {
  id: string;
  workspace_id: string;
  item_id: string;
  motivation: AnnotationMotivation;
  target_xywh: string | null;
  body_value: string | null;
  body_format: string | null;
  creator_user_id: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_MOTIVATIONS: AnnotationMotivation[] = [
  "commenting",
  "tagging",
  "highlighting",
  "describing",
];
const XYWH_RE = /^\d+,\d+,\d+,\d+$/;

function mapAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    itemId: row.item_id,
    motivation: row.motivation,
    targetXywh: row.target_xywh,
    bodyValue: row.body_value,
    bodyFormat: row.body_format,
    creatorUserId: row.creator_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateBody(body: AnnotationCreate): void {
  if (body.motivation && !VALID_MOTIVATIONS.includes(body.motivation)) {
    throw badRequest("Invalid motivation");
  }
  if (body.targetXywh != null && !XYWH_RE.test(body.targetXywh)) {
    throw badRequest("targetXywh must look like 'x,y,w,h'");
  }
  if (body.bodyValue != null && body.bodyValue.length > 16_000) {
    throw badRequest("bodyValue exceeds 16,000 characters");
  }
}

export async function listItemAnnotations(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  const item = await env.DB.prepare(
    `SELECT id FROM items WHERE (id = ? OR slug = ?) AND workspace_id = ? AND deleted_at IS NULL`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<{ id: string }>();
  if (!item) throw notFound();

  const rows = await env.DB.prepare(
    `SELECT * FROM annotations WHERE item_id = ? ORDER BY created_at ASC LIMIT 1000`,
  )
    .bind(item.id)
    .all<AnnotationRow>();

  const payload: ListAnnotationsResponse = {
    annotations: (rows.results ?? []).map(mapAnnotation),
  };
  return Response.json(payload);
}

export async function createAnnotation(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const body = (await req.json().catch(() => null)) as AnnotationCreate | null;
  if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");
  validateBody(body);

  const item = await env.DB.prepare(
    `SELECT id FROM items WHERE (id = ? OR slug = ?) AND workspace_id = ? AND deleted_at IS NULL`,
  )
    .bind(params.id, params.id, auth.workspaceId)
    .first<{ id: string }>();
  if (!item) throw notFound();

  const id = ulid();
  await env.DB.prepare(
    `INSERT INTO annotations
       (id, workspace_id, item_id, motivation, target_xywh, body_value, body_format, creator_user_id)
     VALUES (?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      auth.workspaceId,
      item.id,
      body.motivation ?? "commenting",
      body.targetXywh ?? null,
      body.bodyValue ?? null,
      body.bodyFormat ?? (body.bodyValue ? "text/plain" : null),
      auth.userId,
    )
    .run();

  const row = await env.DB.prepare(`SELECT * FROM annotations WHERE id = ?`)
    .bind(id)
    .first<AnnotationRow>();
  await recordAudit(
    env,
    { workspaceId: auth.workspaceId, userId: auth.userId },
    "annotation.create",
    "annotation",
    id,
    { itemId: item.id },
  );
  const payload: AnnotationResponse = { annotation: mapAnnotation(row!) };
  return Response.json(payload, { status: 201 });
}

export async function updateAnnotation(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const body = (await req.json().catch(() => null)) as AnnotationPatch | null;
  if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");
  validateBody(body);

  const row = await env.DB.prepare(`SELECT * FROM annotations WHERE id = ? AND workspace_id = ?`)
    .bind(params.id, auth.workspaceId)
    .first<AnnotationRow>();
  if (!row) throw notFound();

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.motivation !== undefined) {
    sets.push("motivation = ?");
    binds.push(body.motivation);
  }
  if (body.targetXywh !== undefined) {
    sets.push("target_xywh = ?");
    binds.push(body.targetXywh);
  }
  if (body.bodyValue !== undefined) {
    sets.push("body_value = ?");
    binds.push(body.bodyValue);
  }
  if (body.bodyFormat !== undefined) {
    sets.push("body_format = ?");
    binds.push(body.bodyFormat);
  }
  if (sets.length === 0) throw badRequest("No fields to update");
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");

  await env.DB.prepare(`UPDATE annotations SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds, row.id)
    .run();

  const updated = await env.DB.prepare(`SELECT * FROM annotations WHERE id = ?`)
    .bind(row.id)
    .first<AnnotationRow>();
  const payload: AnnotationResponse = { annotation: mapAnnotation(updated!) };
  return Response.json(payload);
}

export async function deleteAnnotation(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const res = await env.DB.prepare(`DELETE FROM annotations WHERE id = ? AND workspace_id = ?`)
    .bind(params.id, auth.workspaceId)
    .run();
  if (res.meta.changes === 0) throw notFound();
  await recordAudit(
    env,
    { workspaceId: auth.workspaceId, userId: auth.userId },
    "annotation.delete",
    "annotation",
    params.id ?? "",
  );
  return new Response(null, { status: 204 });
}

/**
 * GET /iiif/items/:slug/annotations
 *
 * Unauthenticated IIIF AnnotationPage for an item keyed by its manifest
 * slug. This is the URL referenced from canvas.annotations in the public
 * manifest, so viewers like Mirador load it automatically.
 */
export async function getIiifAnnotationPage(
  _req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const slug = params.slug ?? "";
  const item = await env.DB.prepare(
    `SELECT id, manifest_slug, slug FROM items WHERE (manifest_slug = ? OR slug = ?) AND deleted_at IS NULL`,
  )
    .bind(slug, slug)
    .first<{ id: string; manifest_slug: string | null; slug: string }>();
  if (!item) throw notFound("Annotation page not found");

  const rows = await env.DB.prepare(
    `SELECT * FROM annotations WHERE item_id = ? ORDER BY created_at ASC LIMIT 1000`,
  )
    .bind(item.id)
    .all<AnnotationRow>();

  const publicBaseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const manifestSlug = item.manifest_slug ?? item.slug;
  const canvasId = `${publicBaseUrl}/iiif/manifests/${manifestSlug}/canvas/1`;
  const pageId = `${publicBaseUrl}/iiif/items/${manifestSlug}/annotations`;

  const page = {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    id: pageId,
    type: "AnnotationPage" as const,
    items: (rows.results ?? []).map((r) => ({
      id: `${pageId}/${r.id}`,
      type: "Annotation" as const,
      motivation: r.motivation,
      target: r.target_xywh ? `${canvasId}#xywh=${r.target_xywh}` : canvasId,
      ...(r.body_value
        ? {
            body: {
              type: "TextualBody" as const,
              value: r.body_value,
              format: r.body_format ?? "text/plain",
            },
          }
        : {}),
    })),
  };
  return new Response(JSON.stringify(page), {
    status: 200,
    headers: {
      "Content-Type":
        'application/ld+json;profile="http://iiif.io/api/presentation/3/context.json"',
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=30",
    },
  });
}
