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

  const imageUrl = resolveImageUrl(env, item);
  const width = item.width ?? 1000;
  const height = item.height ?? 1000;

  return buildItemManifest({
    item,
    publicBaseUrl,
    imageUrl,
    width,
    height,
    format: item.mimeType ?? "image/jpeg",
  });
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
