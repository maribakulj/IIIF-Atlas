import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

let auth: Awaited<ReturnType<typeof devSignup>>;
let publicCollectionSlug: string;
let manifestSlug: string;

beforeAll(async () => {
  auth = await devSignup("discovery");

  const cap = await SELF.fetch("http://test.local/api/captures", {
    method: "POST",
    headers: auth.authHeaders,
    body: JSON.stringify({
      pageUrl: "https://example.com/discovery",
      pageTitle: "Discoverable",
      imageUrl: "https://example.com/discovery.jpg",
      mode: "reference",
    }),
  });
  const capBody = (await cap.json()) as { item: { manifestSlug: string } };
  manifestSlug = capBody.item.manifestSlug;

  const col = await SELF.fetch("http://test.local/api/collections", {
    method: "POST",
    headers: auth.authHeaders,
    body: JSON.stringify({ title: "Public collection", isPublic: true }),
  });
  const colBody = (await col.json()) as { collection: { slug: string } };
  publicCollectionSlug = colBody.collection.slug;

  // A private collection should NOT appear in the feed.
  await SELF.fetch("http://test.local/api/collections", {
    method: "POST",
    headers: auth.authHeaders,
    body: JSON.stringify({ title: "Private collection", isPublic: false }),
  });
});

interface ActivityEvent {
  type: string;
  endTime: string;
  object: { id: string; type: string };
}

/**
 * Scan pages of the Change Discovery feed until we find an event whose
 * object.id ends with the given suffix, or we run out of pages. Needed
 * because the feed is chronological ascending and test bootstrap data
 * from other files can push our fixture past page 0.
 */
async function findEvent(suffix: string): Promise<ActivityEvent | null> {
  const top = await SELF.fetch("http://test.local/iiif/activity.json");
  const topBody = (await top.json()) as {
    last: { id: string };
  };
  const lastPage = Number.parseInt(topBody.last.id.split("/").pop() ?? "0", 10);
  for (let n = lastPage; n >= 0; n--) {
    const res = await SELF.fetch(`http://test.local/iiif/activity/page/${n}`);
    const body = (await res.json()) as { orderedItems: ActivityEvent[] };
    const hit = body.orderedItems.find((e) => e.object.id.endsWith(suffix));
    if (hit) return hit;
  }
  return null;
}

describe("IIIF Change Discovery", () => {
  it("serves an OrderedCollection top-level page without auth", async () => {
    const res = await SELF.fetch("http://test.local/iiif/activity.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/ld\+json/);
    const body = (await res.json()) as {
      type: string;
      totalItems: number;
      first: { id: string };
    };
    expect(body.type).toBe("OrderedCollection");
    expect(body.totalItems).toBeGreaterThanOrEqual(2);
    expect(body.first.id).toMatch(/\/iiif\/activity\/page\/0$/);
  });

  it("serves paged orderedItems with Create events for our fixtures", async () => {
    const manifestEvent = await findEvent(`/iiif/manifests/${manifestSlug}`);
    expect(manifestEvent?.type).toBe("Create");
    expect(manifestEvent?.object.type).toBe("Manifest");

    const publicEvent = await findEvent(`/iiif/collections/${publicCollectionSlug}`);
    expect(publicEvent?.type).toBe("Create");

    // Private collections never land in the feed.
    const privateHit = await findEvent("/iiif/collections/private-collection");
    expect(privateHit).toBeNull();
  });
});

describe("GET /sitemap.xml", () => {
  it("lists the public manifest and collection URLs", async () => {
    const res = await SELF.fetch("http://test.local/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/xml/);
    const text = await res.text();
    expect(text).toContain(`/iiif/manifests/${manifestSlug}`);
    expect(text).toContain(`/iiif/collections/${publicCollectionSlug}`);
  });
});

describe("GET /oembed", () => {
  it("returns a rich embed for a manifest URL", async () => {
    const manifestUrl = `http://test.local/iiif/manifests/${manifestSlug}`;
    const res = await SELF.fetch(`http://test.local/oembed?url=${encodeURIComponent(manifestUrl)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      html: string;
      provider_name: string;
    };
    expect(body.type).toBe("rich");
    expect(body.provider_name).toBe("IIIF Atlas");
    expect(body.html).toContain("iframe");
    expect(body.html).toContain(encodeURIComponent(manifestUrl));
  });

  it("rejects URLs that are not manifests on this host", async () => {
    const res = await SELF.fetch(
      "http://test.local/oembed?url=https%3A%2F%2Fexample.com%2Fnot-a-manifest",
    );
    expect(res.status).toBe(404);
  });

  it("requires the url parameter", async () => {
    const res = await SELF.fetch("http://test.local/oembed");
    expect(res.status).toBe(400);
  });
});
