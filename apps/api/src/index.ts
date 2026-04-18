import { corsHeaders, handlePreflight } from "./cors.js";
import type { Env } from "./env.js";
import { HttpError, notFound } from "./errors.js";
import { Router } from "./router.js";

import { streamR2Object } from "./r2.js";
import { createApiKey, devSignup, listApiKeys, me, revokeApiKey } from "./routes/auth.js";
import { createCapture } from "./routes/captures.js";
import {
  createCollection,
  getCollection,
  listCollections,
  updateCollection,
} from "./routes/collections.js";
import { getCollectionBySlug, getManifestBySlug } from "./routes/iiif.js";
import { generateManifest, getItem, listItems, patchItem } from "./routes/items.js";

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
  .get("/api/collections", listCollections)
  .post("/api/collections", createCollection)
  .get("/api/collections/:id", getCollection)
  .patch("/api/collections/:id", updateCollection)
  .get("/iiif/manifests/:slug", getManifestBySlug)
  .get("/iiif/collections/:slug", getCollectionBySlug)
  .get("/healthz", () => new Response("ok", { status: 200 }));

export default {
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
