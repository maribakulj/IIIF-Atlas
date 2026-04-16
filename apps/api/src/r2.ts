import type { Env } from "./env.js";

export function buildR2Key(itemId: string, mime: string): string {
  const ext = mimeToExt(mime);
  return `items/${itemId.slice(0, 2)}/${itemId}.${ext}`;
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/tiff":
      return "tiff";
    case "image/avif":
      return "avif";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

export async function putImage(
  env: Env,
  key: string,
  body: Uint8Array,
  mime: string,
): Promise<void> {
  await env.BUCKET.put(key, body, {
    httpMetadata: { contentType: mime, cacheControl: "public, max-age=31536000, immutable" },
  });
}

export async function streamR2Object(env: Env, key: string): Promise<Response> {
  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { status: 200, headers });
}
