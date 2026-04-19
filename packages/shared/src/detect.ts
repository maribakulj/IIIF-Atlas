/**
 * IIIF detection helpers, usable in the browser (extension content script,
 * web app) and in Workers (server-side follow-ups).
 */

import type { DetectResult } from "./types.js";

const IIIF_CONTEXT_PATTERNS = [/iiif\.io\/api\/presentation\/\d/, /iiif\.io\/api\/image\/\d/];

/** Heuristic: does a URL look like a IIIF info.json endpoint? */
export function looksLikeInfoJson(url: string): boolean {
  return /\/info\.json(\?|$)/i.test(url);
}

/** Heuristic: does a URL look like a IIIF Presentation manifest? */
export function looksLikeManifestUrl(url: string): boolean {
  return /\/manifest(\.json)?(\?|$)/i.test(url) || /manifests?\//i.test(url);
}

/**
 * Detect IIIF signals and image candidates from a DOM document.
 * Intended to run in a content script (browser extension).
 */
export function detectFromDocument(doc: Document): DetectResult {
  const result: DetectResult = { imageCandidates: [] };
  const seen = new Set<string>();
  const push = (u?: string | null) => {
    if (!u) return;
    try {
      const abs = new URL(u, doc.baseURI).toString();
      if (!seen.has(abs)) {
        seen.add(abs);
        result.imageCandidates.push(abs);
      }
    } catch {
      /* ignore invalid URLs */
    }
  };

  // 1) Detect IIIF manifest / info.json hints in <link> and <meta>
  const links = doc.querySelectorAll<HTMLLinkElement>("link[rel][href]");
  for (const ln of Array.from(links)) {
    const rel = (ln.rel || "").toLowerCase();
    const type = (ln.type || "").toLowerCase();
    const href = ln.href;
    if (!href) continue;
    if (
      rel.includes("iiif") ||
      type.includes("iiif") ||
      looksLikeManifestUrl(href) ||
      looksLikeInfoJson(href)
    ) {
      if (looksLikeInfoJson(href)) result.infoJsonUrl ??= href;
      else result.manifestUrl ??= href;
    }
    if (rel === "image_src") push(href);
  }

  // 1a) Common IIIF viewer integrations: Mirador/UV/OSD often expose the
  // manifest URL as a data attribute on a container or a meta tag. These
  // are cheap to check and cover the bulk of institutional embeds.
  const dataSelectors = [
    "[data-iiif-manifest]",
    "[data-iiif-manifest-id]",
    "[data-manifest]",
    "[data-iiif]",
  ];
  for (const sel of dataSelectors) {
    const el = doc.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const attr =
      el.getAttribute("data-iiif-manifest") ??
      el.getAttribute("data-iiif-manifest-id") ??
      el.getAttribute("data-manifest") ??
      el.getAttribute("data-iiif");
    if (attr) {
      try {
        const abs = new URL(attr, doc.baseURI).toString();
        if (looksLikeInfoJson(abs)) result.infoJsonUrl ??= abs;
        else result.manifestUrl ??= abs;
      } catch {
        /* ignore */
      }
    }
  }

  // 1b) Open Graph / meta fallbacks explicitly for IIIF.
  const metaManifest = doc.querySelector<HTMLMetaElement>(
    'meta[name="iiif:manifest"], meta[property="iiif:manifest"], meta[name="iiif-manifest"]',
  )?.content;
  if (metaManifest) {
    try {
      const abs = new URL(metaManifest, doc.baseURI).toString();
      if (looksLikeInfoJson(abs)) result.infoJsonUrl ??= abs;
      else result.manifestUrl ??= abs;
    } catch {
      /* ignore */
    }
  }

  // 2) Scripts with IIIF contexts inlined
  if (!result.manifestUrl) {
    const scripts = doc.querySelectorAll<HTMLScriptElement>(
      'script[type="application/json"], script[type="application/ld+json"]',
    );
    for (const s of Array.from(scripts)) {
      const text = s.textContent ?? "";
      if (IIIF_CONTEXT_PATTERNS.some((re) => re.test(text))) {
        const m = text.match(/"id"\s*:\s*"([^"]+)"/);
        if (m && m[1]) {
          const candidate = m[1];
          if (looksLikeInfoJson(candidate)) result.infoJsonUrl ??= candidate;
          else result.manifestUrl ??= candidate;
          break;
        }
      }
    }
  }

  // 3) og:image / twitter:image
  const meta = (name: string) =>
    doc.querySelector<HTMLMetaElement>(`meta[property="${name}"], meta[name="${name}"]`)?.content;
  const og = meta("og:image");
  const tw = meta("twitter:image");
  if (og) push(og);
  if (tw) push(tw);

  // 4) Large <img> elements — score by area
  const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>("img[src]"));
  const ranked = imgs
    .map((img) => {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      return { url: img.src, area: w * h };
    })
    .filter((x) => x.url && x.area > 10_000)
    .sort((a, b) => b.area - a.area);
  for (const r of ranked.slice(0, 10)) push(r.url);

  // Primary image: prefer og:image, else the largest <img>
  result.primaryImageUrl = og || tw || ranked[0]?.url || result.imageCandidates[0];

  // Title
  result.pageTitle = doc.title || undefined;

  return result;
}

/**
 * Best-effort classification of a fetched JSON document as a IIIF resource.
 * Used server-side when validating a manifestUrl / infoJsonUrl submission.
 */
export function classifyIIIFJson(json: unknown): {
  kind: "manifest" | "collection" | "image-info" | "unknown";
  version?: 2 | 3;
} {
  if (!json || typeof json !== "object") return { kind: "unknown" };
  const obj = json as Record<string, unknown>;
  const ctx = obj["@context"];
  const ctxStr = Array.isArray(ctx) ? ctx.join(" ") : typeof ctx === "string" ? ctx : "";
  const version: 2 | 3 | undefined = /presentation\/3/.test(ctxStr)
    ? 3
    : /presentation\/2/.test(ctxStr)
      ? 2
      : /image\/3/.test(ctxStr)
        ? 3
        : /image\/2/.test(ctxStr)
          ? 2
          : undefined;
  const type = obj["type"] ?? obj["@type"];
  if (type === "Manifest" || type === "sc:Manifest") return { kind: "manifest", version };
  if (type === "Collection" || type === "sc:Collection") return { kind: "collection", version };
  if (type === "ImageService2" || type === "ImageService3" || /image\/\d/.test(ctxStr)) {
    return { kind: "image-info", version };
  }
  if (obj["sequences"] || obj["items"]) return { kind: "manifest", version };
  return { kind: "unknown", version };
}
