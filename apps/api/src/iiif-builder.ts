import { buildCollection, buildItemManifest } from "@iiif-atlas/shared";
import type { Collection, IIIFCollection, IIIFManifest, Item } from "@iiif-atlas/shared";
import { getLimits } from "./env.js";
import type { Env } from "./env.js";
import { safeFetchJson } from "./fetch-safe.js";

/**
 * Build a manifest for a stored item. For mode=iiif_reuse we fetch and
 * normalize the upstream manifest; otherwise we synthesize a minimal one.
 *
 * Width/height fall back to 1000x1000 in the MVP when we have no probed
 * values; a follow-up can run Image API `info.json` probing or server-side
 * image dimension detection.
 */
export async function buildManifestForItem(env: Env, item: Item): Promise<IIIFManifest> {
  const { fetchTimeoutMs, maxBytes } = getLimits(env);
  const publicBaseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");

  if (item.mode === "iiif_reuse" && item.sourceManifestUrl) {
    try {
      const upstream = await safeFetchJson<IIIFManifest>(item.sourceManifestUrl, {
        timeoutMs: fetchTimeoutMs,
        maxBytes,
      });
      // Rewrite the @id to our public URL so consumers see stable URLs.
      if (item.manifestSlug) {
        upstream.id = `${publicBaseUrl}/iiif/manifests/${item.manifestSlug}`;
      }
      if (!upstream["@context"])
        upstream["@context"] = "http://iiif.io/api/presentation/3/context.json";
      return upstream;
    } catch {
      // Fall through to synthesized manifest below.
    }
  }

  const width = item.width ?? 1000;
  const height = item.height ?? 1000;
  const format = item.mimeType ?? "image/jpeg";

  // For cached items we route through our own Image API service so that
  // viewers (Mirador, UV) get a real ImageService3 reference and the
  // canonical body URI is the IIIF level-0 endpoint rather than a raw R2
  // URL. For reference-only items we fall back to the original source.
  const useImageService = item.mode === "cached" && item.assetSha256;
  const serviceId = useImageService ? `${publicBaseUrl}/iiif/image/${item.assetSha256}` : null;
  const imageUrl = serviceId
    ? `${serviceId}/full/max/0/default.${nativeExtForMime(format)}`
    : resolveImageUrl(env, item);

  return buildItemManifest({
    item,
    publicBaseUrl,
    imageUrl,
    width,
    height,
    format,
    ...(serviceId
      ? { imageService: { id: serviceId, type: "ImageService3", profile: "level0" } }
      : {}),
  });
}

function nativeExtForMime(mime: string): string {
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
      return "tif";
    case "image/avif":
      return "avif";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

export function buildCollectionManifest(
  env: Env,
  collection: Collection,
  items: Item[],
): IIIFCollection {
  const publicBaseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return buildCollection({ collection, publicBaseUrl, items });
}

function resolveImageUrl(env: Env, item: Item): string {
  const publicBaseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (item.mode === "cached" && item.r2Key) return `${publicBaseUrl}/r2/${item.r2Key}`;
  return item.sourceImageUrl ?? `${publicBaseUrl}/static/missing.png`;
}
