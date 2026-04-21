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
    const res = await SELF.fetch("http://test.local/iiif/activity/page/0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      orderedItems: Array<{
        type: string;
        endTime: string;
        object: { id: string; type: string };
      }>;
    };
    expect(body.type).toBe("OrderedCollectionPage");
    const manifestEvent = body.orderedItems.find((e) =>
      e.object.id.endsWith(`/iiif/manifests/${manifestSlug}`),
    );
    expect(manifestEvent?.type).toBe("Create");
    expect(manifestEvent?.object.type).toBe("Manifest");

    const publicEvent = body.orderedItems.find((e) =>
      e.object.id.endsWith(`/iiif/collections/${publicCollectionSlug}`),
    );
    expect(publicEvent?.type).toBe("Create");
    // Private collections never land in the feed.
    expect(body.orderedItems.some((e) => /private-collection/.test(e.object.id))).toBe(false);
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
