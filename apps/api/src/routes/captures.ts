import type { CapturePayload, CreateCaptureResponse, IngestionMode } from "@iiif-atlas/shared";
import { classifyIIIFJson } from "@iiif-atlas/shared";
import { requireAuth, requireWriter } from "../auth.js";
import { mapItem } from "../db.js";
import type { ItemRow } from "../db.js";
import type { Env } from "../env.js";
import { getLimits } from "../env.js";
import { badRequest, unprocessable } from "../errors.js";
import { safeFetch, safeFetchJson } from "../fetch-safe.js";
import { buildR2Key, putImage } from "../r2.js";
import { itemSlug, ulid } from "../slug.js";
import { assertOutboundUrl } from "../ssrf.js";

export async function createCapture(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);
  const body = (await req.json().catch(() => null)) as CapturePayload | null;
  if (!body || typeof body !== "object") throw badRequest("Invalid JSON body");

  if (!body.pageUrl || typeof body.pageUrl !== "string") {
    throw badRequest("pageUrl is required");
  }
  assertOutboundUrl(body.pageUrl);

  const mode: IngestionMode = (body.mode ?? "reference") as IngestionMode;
  if (!["reference", "cached", "iiif_reuse"].includes(mode)) {
    throw badRequest("mode must be 'reference', 'cached' or 'iiif_reuse'");
  }

  // Validate image / manifest URLs if provided
  if (body.imageUrl) assertOutboundUrl(body.imageUrl);
  if (body.manifestUrl) assertOutboundUrl(body.manifestUrl);
  if (body.infoJsonUrl) assertOutboundUrl(body.infoJsonUrl);

  const limits = getLimits(env);
  const captureId = ulid();
  const itemId = ulid();
  const title = (body.metadata?.title as string | undefined) ?? body.pageTitle ?? null;
  const slug = itemSlug(title ?? body.pageTitle ?? "item");
  const manifestSlug = slug; // 1:1 in the MVP
  const capturedAt = body.capturedAt ?? new Date().toISOString();

  let r2Key: string | null = null;
  let mime: string | null = null;
  let byteSize: number | null = null;
  let sourceManifestUrl: string | null = null;

  // iiif_reuse: validate the manifest is reachable & looks like IIIF.
  if (mode === "iiif_reuse") {
    const src = body.manifestUrl ?? body.infoJsonUrl;
    if (!src) throw badRequest("iiif_reuse requires manifestUrl or infoJsonUrl");
    const json = await safeFetchJson(src, {
      timeoutMs: limits.fetchTimeoutMs,
      maxBytes: limits.maxBytes,
    });
    const cls = classifyIIIFJson(json);
    if (cls.kind === "unknown") {
      throw unprocessable("URL does not look like a IIIF resource");
    }
    sourceManifestUrl = src;
  }

  // cached: download the image into R2.
  if (mode === "cached") {
    if (!body.imageUrl) throw badRequest("cached mode requires imageUrl");
    const res = await safeFetch(body.imageUrl, {
      timeoutMs: limits.fetchTimeoutMs,
      maxBytes: limits.maxBytes,
      allowedMime: limits.allowedMime,
    });
    mime = res.mime;
    byteSize = res.body.byteLength;
    r2Key = buildR2Key(itemId, mime);
    await putImage(env, r2Key, res.body, mime);
  }

  const metadataJson = body.metadata ? JSON.stringify(body.metadata) : null;

  const description = (body.metadata?.description as string | undefined) ?? null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO items (
        id, slug, title, description, mode,
        source_page_url, source_page_title, source_image_url, source_manifest_url,
        r2_key, mime_type, byte_size,
        manifest_slug,
        captured_at, metadata_json,
        workspace_id
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      itemId,
      slug,
      title,
      description,
      mode,
      body.pageUrl,
      body.pageTitle ?? null,
      body.imageUrl ?? null,
      sourceManifestUrl,
      r2Key,
      mime,
      byteSize,
      manifestSlug,
      capturedAt,
      metadataJson,
      auth.workspaceId,
    ),
    env.DB.prepare(
      `INSERT INTO captures (id, payload_json, resulting_item_id, workspace_id) VALUES (?,?,?,?)`,
    ).bind(captureId, JSON.stringify(body), itemId, auth.workspaceId),
  ]);

  const row = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
    .bind(itemId)
    .first<ItemRow>();
  if (!row) throw new Error("Failed to load inserted item");

  const payload: CreateCaptureResponse = {
    capture: { id: captureId, createdAt: new Date().toISOString() },
    item: mapItem(row, env.PUBLIC_BASE_URL),
  };
  return Response.json(payload, { status: 201 });
}
