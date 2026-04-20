import { corsHeaders, handlePreflight } from "./cors.js";
import type { Env } from "./env.js";
import { HttpError, notFound } from "./errors.js";
import { Router } from "./router.js";

import { processIngestJob } from "./ingest.js";
import type { IngestMessage } from "./queue.js";
import { streamR2Object } from "./r2.js";
import {
  createAnnotation,
  deleteAnnotation,
  getIiifAnnotationPage,
  listItemAnnotations,
  updateAnnotation,
} from "./routes/annotations.js";
import { createApiKey, devSignup, listApiKeys, me, revokeApiKey } from "./routes/auth.js";
import { createCapture } from "./routes/captures.js";
import {
  createCollection,
  getCollection,
  listCollections,
  updateCollection,
} from "./routes/collections.js";
import { exportItems } from "./routes/export.js";
import { getCollectionBySlug, getManifestBySlug } from "./routes/iiif.js";
import { getImageData, getImageInfo } from "./routes/image.js";
import { generateManifest, getItem, listItems, patchItem, retryItem } from "./routes/items.js";
import { createShare, listShares, resolveShare, revokeShare } from "./routes/shares.js";
import { addTagToItem, listTags, removeTagFromItem } from "./routes/tags.js";

const router = new Router()
  .post("/api/auth/dev-signup", devSignup)
  .get("/api/auth/me", me)
  .get("/api/auth/api-keys", listApiKeys)
  .post("/api/auth/api-keys", createApiKey)
  .del("/api/auth/api-keys/:id", revokeApiKey)
  .post("/api/captures", createCapture)
  .get("/api/items", listItems)
  .post("/api/items", createCapture) // POST /api/items is an alias used by the web app
  .get("/api/items/:id", getItem)
  .patch("/api/items/:id", patchItem)
  .post("/api/items/:id/generate-manifest", generateManifest)
  .post("/api/items/:id/retry", retryItem)
  .post("/api/items/:id/tags", addTagToItem)
  .del("/api/items/:id/tags/:tag", removeTagFromItem)
  .get("/api/items/:id/annotations", listItemAnnotations)
  .post("/api/items/:id/annotations", createAnnotation)
  .patch("/api/annotations/:id", updateAnnotation)
  .del("/api/annotations/:id", deleteAnnotation)
  .get("/api/export/items", exportItems)
  .get("/api/tags", listTags)
  .post("/api/shares", createShare)
  .get("/api/shares", listShares)
  .get("/api/shares/:token", resolveShare)
  .del("/api/shares/:id", revokeShare)
  .get("/api/collections", listCollections)
  .post("/api/collections", createCollection)
  .get("/api/collections/:id", getCollection)
  .patch("/api/collections/:id", updateCollection)
  .get("/iiif/manifests/:slug", getManifestBySlug)
  .get("/iiif/collections/:slug", getCollectionBySlug)
  .get("/iiif/items/:slug/annotations", getIiifAnnotationPage)
  .get("/iiif/image/:id/info.json", getImageInfo)
  .get("/iiif/image/:id/:region/:size/:rotation/:filename", getImageData)
  .get("/healthz", () => new Response("ok", { status: 200 }));

export default {
  /**
   * Cloudflare Queues consumer. Each message corresponds to one item that
   * needs cached-mode ingestion. We process them one at a time and let the
   * queue retry policy handle backoff; messages that throw stay in-flight
   * for the configured max attempts before landing in the DLQ.
   */
  async queue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const msg of batch.messages) {
      try {
        const body = msg.body as IngestMessage;
        if (body && body.type === "ingest_cached") {
          await processIngestJob(env, body.itemId);
        }
        msg.ack();
      } catch (err) {
        console.error("[ingest] job failed", err);
        msg.retry();
      }
    }
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const preflight = handlePreflight(req, env);
    if (preflight) return preflight;

    try {
      const url = new URL(req.url);

      // R2 passthrough: /r2/<key...>
      if (url.pathname.startsWith("/r2/") && req.method === "GET") {
        const key = url.pathname.slice("/r2/".length);
        const res = await streamR2Object(env, key);
        const headers = new Headers(res.headers);
        const cors = corsHeaders(req, env);
        for (const [k, v] of Object.entries(cors as Record<string, string>)) {
          headers.set(k, v);
        }
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(res.body, { status: res.status, headers });
      }

      const routed = await router.handle(req, env, ctx);
      if (routed) return withCors(routed, req, env);
      throw notFound();
    } catch (err) {
      const res = errorResponse(err);
      return withCors(res, req, env);
    }
  },
} satisfies ExportedHandler<Env>;

function withCors(res: Response, req: Request, env: Env): Response {
  const headers = new Headers(res.headers);
  const cors = corsHeaders(req, env);
  for (const [k, v] of Object.entries(cors as Record<string, string>)) {
    headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json(
      { error: err.code, message: err.message, details: err.details ?? null },
      { status: err.status },
    );
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return Response.json({ error: "internal_error", message }, { status: 500 });
}
