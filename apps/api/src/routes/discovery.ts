/**
 * Public interop endpoints — no auth required.
 *
 *  GET /iiif/activity.json         IIIF Change Discovery OrderedCollection
 *  GET /iiif/activity/page/:n      OrderedCollectionPage (100 events per page)
 *  GET /sitemap.xml                Sitemap of public manifests + collections
 *  GET /oembed?url=…               oEmbed JSON for a manifest URL
 */

import type { Env } from "./../env.js";
import { badRequest, notFound } from "./../errors.js";

const PAGE_SIZE = 100;

interface ActivityRow {
  id: string;
  verb: "Create" | "Update" | "Delete";
  object_type: "Manifest" | "Collection";
  object_slug: string;
  created_at: string;
}

const DISCOVERY_CONTEXT = "http://iiif.io/api/discovery/1/context.json";

const LD_HEADERS: HeadersInit = {
  "Content-Type": 'application/ld+json;profile="http://iiif.io/api/discovery/1/context.json"',
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};

function publicBase(env: Env): string {
  return env.PUBLIC_BASE_URL.replace(/\/$/, "");
}

function objectUrl(base: string, type: "Manifest" | "Collection", slug: string): string {
  return type === "Manifest"
    ? `${base}/iiif/manifests/${slug}`
    : `${base}/iiif/collections/${slug}`;
}

async function countEvents(env: Env): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM activity_events`).first<{
    c: number;
  }>();
  return row?.c ?? 0;
}

/** GET /iiif/activity.json — top-level collection. */
export async function getActivityCollection(_req: Request, env: Env): Promise<Response> {
  const total = await countEvents(env);
  const base = publicBase(env);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const body = {
    "@context": DISCOVERY_CONTEXT,
    id: `${base}/iiif/activity.json`,
    type: "OrderedCollection" as const,
    totalItems: total,
    first: { id: `${base}/iiif/activity/page/0`, type: "OrderedCollectionPage" as const },
    last: {
      id: `${base}/iiif/activity/page/${lastPage}`,
      type: "OrderedCollectionPage" as const,
    },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: LD_HEADERS });
}

/** GET /iiif/activity/page/:n — oldest-to-newest pages (IIIF spec). */
export async function getActivityPage(
  _req: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const n = Math.max(0, Number.parseInt(params.n ?? "0", 10) || 0);
  const total = await countEvents(env);
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  if (n > lastPage && total > 0) throw notFound("Page out of range");

  const offset = n * PAGE_SIZE;
  const rows = await env.DB.prepare(
    `SELECT * FROM activity_events ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`,
  )
    .bind(PAGE_SIZE, offset)
    .all<ActivityRow>();

  const base = publicBase(env);
  const pageBase = `${base}/iiif/activity/page`;
  const body: Record<string, unknown> = {
    "@context": DISCOVERY_CONTEXT,
    id: `${pageBase}/${n}`,
    type: "OrderedCollectionPage",
    partOf: { id: `${base}/iiif/activity.json`, type: "OrderedCollection" },
    orderedItems: (rows.results ?? []).map((r) => ({
      id: `${base}/iiif/activity/event/${r.id}`,
      type: r.verb,
      endTime: r.created_at,
      object: {
        id: objectUrl(base, r.object_type, r.object_slug),
        type: r.object_type,
      },
    })),
  };
  if (n > 0) body.prev = { id: `${pageBase}/${n - 1}`, type: "OrderedCollectionPage" };
  if (n < lastPage) body.next = { id: `${pageBase}/${n + 1}`, type: "OrderedCollectionPage" };

  return new Response(JSON.stringify(body), { status: 200, headers: LD_HEADERS });
}

/** GET /sitemap.xml — public manifests (always) + public collections. */
export async function getSitemap(_req: Request, env: Env): Promise<Response> {
  const base = publicBase(env);
  const manifestRows = await env.DB.prepare(
    `SELECT manifest_slug AS slug, updated_at FROM items
      WHERE manifest_slug IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 10000`,
  ).all<{ slug: string; updated_at: string }>();
  const collectionRows = await env.DB.prepare(
    `SELECT slug, updated_at FROM collections
      WHERE is_public = 1
      ORDER BY updated_at DESC
      LIMIT 10000`,
  ).all<{ slug: string; updated_at: string }>();

  const entries: string[] = [];
  for (const r of manifestRows.results ?? []) {
    entries.push(
      `  <url><loc>${xmlEscape(`${base}/iiif/manifests/${r.slug}`)}</loc><lastmod>${xmlEscape(r.updated_at.slice(0, 10))}</lastmod></url>`,
    );
  }
  for (const r of collectionRows.results ?? []) {
    entries.push(
      `  <url><loc>${xmlEscape(`${base}/iiif/collections/${r.slug}`)}</loc><lastmod>${xmlEscape(r.updated_at.slice(0, 10))}</lastmod></url>`,
    );
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}

/**
 * GET /oembed?url=https://…/iiif/manifests/slug
 *
 * Responds with an oEmbed "rich" type whose html embeds a Mirador viewer
 * pointed at the manifest. Consumers (Slack, WordPress, …) will auto-
 * preview the URL on paste if the manifest page also advertises the
 * endpoint (deferred to a future SSR layer).
 */
export async function getOembed(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  const format = url.searchParams.get("format") ?? "json";
  if (format !== "json") throw badRequest("Only json format is supported");
  if (!target) throw badRequest("url parameter is required");

  const base = publicBase(env);
  const prefix = `${base}/iiif/manifests/`;
  if (!target.startsWith(prefix)) throw notFound("URL is not an IIIF manifest on this host");
  const slug = target.slice(prefix.length).replace(/\/$/, "");
  const row = await env.DB.prepare(
    `SELECT title, slug FROM items WHERE manifest_slug = ? OR slug = ? LIMIT 1`,
  )
    .bind(slug, slug)
    .first<{ title: string | null; slug: string }>();
  if (!row) throw notFound("Manifest not found");

  const width = 800;
  const height = 600;
  // Mirador's hosted embed page renders any IIIF manifest via its query
  // parameter. Switching providers (Universal Viewer, Clover) is a
  // content-type upgrade, not a schema change.
  const embed = `https://projectmirador.org/embed/?iiif-content=${encodeURIComponent(target)}`;
  const payload = {
    version: "1.0",
    type: "rich",
    provider_name: "IIIF Atlas",
    provider_url: base,
    title: row.title ?? row.slug,
    width,
    height,
    html: `<iframe src="${embed}" width="${width}" height="${height}" frameborder="0" allowfullscreen></iframe>`,
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
