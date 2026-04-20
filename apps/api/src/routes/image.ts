/**
 * IIIF Image API 3.0 — level 0 implementation.
 *
 * Level 0 is the conformance class that requires only a single canonical
 * URI per image: `{id}/full/max/0/default.{format}`. We don't promise
 * region/size/rotation/quality transforms, but we DO emit a valid
 * info.json so Mirador & friends can render the image (and would benefit
 * from a future level-1 upgrade transparently).
 *
 * Spec: https://iiif.io/api/image/3.0/
 */

import type { IIIFImageInfo3 } from "@iiif-atlas/shared";
import { IIIF_IMAGE_CONTEXT } from "@iiif-atlas/shared";
import type { Env } from "../env.js";
import { notFound } from "../errors.js";
import { streamR2Object } from "../r2.js";

interface AssetRow {
  sha256: string;
  mime: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  r2_key: string;
}

const INFO_HEADERS: HeadersInit = {
  "Content-Type": 'application/ld+json;profile="http://iiif.io/api/image/3/context.json"',
  Link: '<http://iiif.io/api/image/3/level0.json>;rel="profile"',
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=3600",
};

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/tiff": "tif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

function publicBase(env: Env): string {
  return env.PUBLIC_BASE_URL.replace(/\/$/, "");
}

function imageServiceId(env: Env, sha: string): string {
  return `${publicBase(env)}/iiif/image/${sha}`;
}

async function loadAsset(env: Env, sha: string): Promise<AssetRow | null> {
  return env.DB.prepare(`SELECT * FROM assets WHERE sha256 = ?`).bind(sha).first<AssetRow>();
}

/** Returns the canonical extension (`jpg`, `png`, …) for a stored asset. */
export function nativeExtForMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? "bin";
}

/**
 * GET /iiif/image/:id/info.json
 *
 * Always present for an asset that exists; 404 otherwise. Level-0
 * profile, no tiles, dimensions taken from the assets row (probed at
 * ingestion time — see `image-probe.ts`).
 */
export async function getImageInfo(
  _req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const id = params.id ?? "";
  if (!id) throw notFound("Image not found");
  const asset = await loadAsset(env, id);
  if (!asset) throw notFound("Image not found");
  const info: IIIFImageInfo3 = {
    "@context": IIIF_IMAGE_CONTEXT,
    id: imageServiceId(env, asset.sha256),
    type: "ImageService3",
    protocol: "http://iiif.io/api/image",
    profile: "level0",
    width: asset.width ?? 1,
    height: asset.height ?? 1,
    extraFormats: [nativeExtForMime(asset.mime)],
  };
  return new Response(JSON.stringify(info), { status: 200, headers: INFO_HEADERS });
}

/**
 * GET /iiif/image/:id/:region/:size/:rotation/:filename
 *
 * Level 0: only `full/max/0/default.{native-ext}` is honored — exactly
 * the canonical URI from the spec. Anything else returns 501 with a
 * descriptive body so a curious client can debug.
 */
export async function getImageData(
  _req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const id = params.id ?? "";
  if (!id) throw notFound("Image not found");
  const asset = await loadAsset(env, id);
  if (!asset) throw notFound("Image not found");

  if (params.region !== "full") return level0Reject("region");
  if (params.size !== "max" && params.size !== "full") return level0Reject("size");
  if (params.rotation !== "0") return level0Reject("rotation");

  const filename = params.filename ?? "";
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return level0Reject("filename");
  const quality = filename.slice(0, dot);
  const ext = filename.slice(dot + 1).toLowerCase();
  if (quality !== "default" && quality !== "color") return level0Reject("quality");

  const expectedExt = nativeExtForMime(asset.mime);
  if (ext !== expectedExt) {
    // Format conversion is a level-2 feature — out of scope here.
    return new Response(`Image is available only as ${expectedExt}. Requested format: ${ext}`, {
      status: 501,
    });
  }

  const res = await streamR2Object(env, asset.r2_key);
  if (res.status !== 200) return res;
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(res.body, { status: res.status, headers });
}

function level0Reject(field: string): Response {
  return new Response(
    `Only the canonical 'full/max/0/default.{ext}' URI is supported (level 0). Bad ${field}.`,
    { status: 501 },
  );
}
