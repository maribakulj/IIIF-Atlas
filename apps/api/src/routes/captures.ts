import type {
  CapturePayload,
  CreateCaptureResponse,
  IngestionMode,
  ItemStatus,
} from "@iiif-atlas/shared";
import { classifyIIIFJson } from "@iiif-atlas/shared";
import { recordActivity } from "../activity.js";
import { recordAudit } from "../audit.js";
import { requireAuth, requireWriter } from "../auth.js";
import { mapItem } from "../db.js";
import type { ItemRow } from "../db.js";
import type { Env } from "../env.js";
import { getLimits } from "../env.js";
import { badRequest, tooManyRequests, unprocessable } from "../errors.js";
import { safeFetchJson } from "../fetch-safe.js";
import { enqueueIngest } from "../queue.js";
import { checkRateLimit } from "../ratelimit.js";
import { itemSlug, ulid } from "../slug.js";
import { assertOutboundUrl } from "../ssrf.js";

/** 30 captures/minute sustained, burst of 30. Plenty for a human, */
/** throttles a runaway bot. */
const CAPTURE_CAPACITY = 30;
const CAPTURE_REFILL_PER_SECOND = 0.5;

export async function createCapture(req: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(req, env);
  requireWriter(auth);

  const limit = await checkRateLimit(
    env,
    `capture:${auth.apiKeyId}`,
    CAPTURE_CAPACITY,
    CAPTURE_REFILL_PER_SECOND,
  );
  if (!limit.allowed) {
    throw tooManyRequests("Capture rate limit exceeded", {
      retryAfter: limit.retryAfter ?? 1,
    });
  }

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

  let sourceManifestUrl: string | null = null;

  // iiif_reuse: validate the manifest is reachable & looks like IIIF before
  // we let it land in the library — synchronous, since it's cheap and
  // gives the user immediate feedback on bad input.
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

  if (mode === "cached" && !body.imageUrl) {
    throw badRequest("cached mode requires imageUrl");
  }

  const regionXywh =
    typeof body.regionXywh === "string" && /^\d+,\d+,\d+,\d+$/.test(body.regionXywh)
      ? body.regionXywh
      : null;

  const metadataJson = body.metadata ? JSON.stringify(body.metadata) : null;
  const description = (body.metadata?.description as string | undefined) ?? null;
  // Cached items are 'processing' until the queue worker is done; the
  // others are immediately serviceable.
  const status: ItemStatus = mode === "cached" ? "processing" : "ready";

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO items (
        id, slug, title, description, mode,
        source_page_url, source_page_title, source_image_url, source_manifest_url,
        manifest_slug,
        captured_at, metadata_json,
        workspace_id, status, region_xywh
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      manifestSlug,
      capturedAt,
      metadataJson,
      auth.workspaceId,
      status,
      regionXywh,
    ),
    env.DB.prepare(
      `INSERT INTO captures (id, payload_json, resulting_item_id, workspace_id) VALUES (?,?,?,?)`,
    ).bind(captureId, JSON.stringify(body), itemId, auth.workspaceId),
  ]);

  // Announce the new manifest on the public Change Discovery feed.
  await recordActivity(env, "Create", "Manifest", manifestSlug);
  await recordAudit(
    env,
    { workspaceId: auth.workspaceId, userId: auth.userId },
    "item.create",
    "item",
    itemId,
    { mode, slug },
  );

  // Hand off the heavy lifting. With INGEST_QUEUE this returns immediately;
  // without it (tests, single-instance dev) the work runs inline before
  // we respond, so the item is already 'ready' by the time the client
  // receives the row below.
  if (mode === "cached") {
    await enqueueIngest(env, itemId);
  }

  const row = await env.DB.prepare(`SELECT * FROM items WHERE id = ?`)
    .bind(itemId)
    .first<ItemRow>();
  if (!row) throw new Error("Failed to load inserted item");

  const payload: CreateCaptureResponse = {
    capture: { id: captureId, createdAt: new Date().toISOString() },
    item: mapItem(row, env.PUBLIC_BASE_URL),
  };
  // 202 when the work continues asynchronously, 201 otherwise.
  const respStatus = mode === "cached" && env.INGEST_QUEUE ? 202 : 201;
  return Response.json(payload, { status: respStatus });
}
