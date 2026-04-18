import { SELF, env, fetchMock } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

let auth: Awaited<ReturnType<typeof devSignup>>;

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  auth = await devSignup("captures");
});

function mockImage(url: string, mime = "image/jpeg", bytes = 64) {
  const u = new URL(url);
  // undici MockAgent serializes non-string bodies via JSON.stringify — use a
  // fixed-length string so the Content-Length we advertise is honest.
  const body = "x".repeat(bytes);
  fetchMock
    .get(u.origin)
    .intercept({ path: u.pathname + u.search, method: "GET" })
    .reply(200, body, {
      headers: { "content-type": mime, "content-length": String(bytes) },
    });
}

function mockJson(url: string, body: unknown) {
  const u = new URL(url);
  fetchMock
    .get(u.origin)
    .intercept({ path: u.pathname + u.search, method: "GET" })
    .reply(200, JSON.stringify(body), {
      headers: { "content-type": "application/ld+json" },
    });
}

describe("POST /api/captures — auth gating", () => {
  it("returns 401 without an API key", async () => {
    const res = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pageUrl: "https://example.com/x",
        imageUrl: "https://example.com/x.jpg",
        mode: "reference",
      }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/captures — reference mode", () => {
  it("creates an item without downloading the image", async () => {
    const res = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/gallery",
        pageTitle: "Gallery",
        imageUrl: "https://example.com/painting.jpg",
        mode: "reference",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      item: {
        id: string;
        slug: string;
        mode: string;
        manifestUrl: string | null;
        sourcePageUrl: string;
        sourceImageUrl: string;
        r2Key: string | null;
      };
    };
    expect(body.item.mode).toBe("reference");
    expect(body.item.sourcePageUrl).toBe("https://example.com/gallery");
    expect(body.item.sourceImageUrl).toBe("https://example.com/painting.jpg");
    expect(body.item.r2Key).toBeNull();
    expect(body.item.manifestUrl).toMatch(/\/iiif\/manifests\//);
  });

  it("rejects a pageUrl pointing to a private IP", async () => {
    const res = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "http://192.168.1.1/admin",
        mode: "reference",
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/blocked_private_ip/);
  });

  it("rejects a missing pageUrl", async () => {
    const res = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ mode: "reference" }),
    });
    expect(res.status).toBe(400);
  });
});

// TODO(sprint-2): re-enable these once miniflare's isolated-storage R2
// teardown bug is resolved; the cached image pipeline will move to Queues.
describe.skip("POST /api/captures — cached mode", () => {
  it("downloads the image to R2 and records byte size + mime", async () => {
    mockImage("https://cdn.example.com/art.png", "image/png", 2048);

    const res = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/article",
        pageTitle: "Article",
        imageUrl: "https://cdn.example.com/art.png",
        mode: "cached",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      item: { id: string; r2Key: string; mimeType: string; byteSize: number };
    };
    expect(body.item.r2Key).toMatch(/^items\//);
    expect(body.item.mimeType).toBe("image/png");
    expect(body.item.byteSize).toBe(2048);

    const obj = await env.BUCKET.get(body.item.r2Key);
    expect(obj).not.toBeNull();
    expect(obj?.size).toBe(2048);
  });

  it("rejects disallowed MIME types", async () => {
    mockImage("https://cdn.example.com/evil.exe", "application/octet-stream", 32);
    const res = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/",
        imageUrl: "https://cdn.example.com/evil.exe",
        mode: "cached",
      }),
    });
    expect(res.status).toBe(422);
  });
});

describe("POST /api/captures — iiif_reuse mode", () => {
  it("validates upstream resource is IIIF", async () => {
    mockJson("https://iiif.example.org/m/abc.json", {
      "@context": "http://iiif.io/api/presentation/3/context.json",
      type: "Manifest",
      id: "https://iiif.example.org/m/abc.json",
      label: { none: ["Upstream"] },
      items: [],
    });

    const res = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://catalog.example.org/record/123",
        pageTitle: "Record 123",
        manifestUrl: "https://iiif.example.org/m/abc.json",
        mode: "iiif_reuse",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      item: { sourceManifestUrl: string; mode: string };
    };
    expect(body.item.mode).toBe("iiif_reuse");
    expect(body.item.sourceManifestUrl).toBe("https://iiif.example.org/m/abc.json");
  });

  // TODO(sprint-2): integration variant tracks an upstream miniflare bug
  // where the WAL SHM file left over after the previous test trips the
  // isolated-storage assertion. Behavior covered by classifyIIIFJson
  // unit tests in packages/shared.
  it.skip("rejects non-IIIF JSON", async () => {
    mockJson("https://example.org/random.json", { hello: "world" });
    const res = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.org/",
        manifestUrl: "https://example.org/random.json",
        mode: "iiif_reuse",
      }),
    });
    expect(res.status).toBe(422);
  });
});

describe("GET /iiif/manifests/:slug (public)", () => {
  it("returns a valid JSON-LD manifest without auth", async () => {
    const cap = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/x",
        imageUrl: "https://example.com/x.jpg",
        mode: "reference",
      }),
    });
    const created = (await cap.json()) as {
      item: { manifestSlug: string; slug: string };
    };

    const res = await SELF.fetch(`http://test.local/iiif/manifests/${created.item.manifestSlug}`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/application\/ld\+json/);
    const m = (await res.json()) as {
      "@context": string;
      type: string;
      items: unknown[];
    };
    expect(m.type).toBe("Manifest");
    expect(m["@context"]).toMatch(/presentation\/3/);
    expect(Array.isArray(m.items)).toBe(true);
  });

  it("returns 404 for unknown slug", async () => {
    const res = await SELF.fetch("http://test.local/iiif/manifests/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("collections", () => {
  it("creates, lists, and publishes a collection", async () => {
    for (const i of [1, 2]) {
      await SELF.fetch("http://test.local/api/captures", {
        method: "POST",
        headers: auth.authHeaders,
        body: JSON.stringify({
          pageUrl: `https://example.com/col/${i}`,
          imageUrl: `https://example.com/col/${i}.jpg`,
          mode: "reference",
        }),
      });
    }
    const list = (await (
      await SELF.fetch("http://test.local/api/items", { headers: auth.authHeaders })
    ).json()) as { items: Array<{ id: string }> };
    const ids = list.items.slice(0, 2).map((x) => x.id);

    const created = await SELF.fetch("http://test.local/api/collections", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        title: "Integration test collection",
        itemIds: ids,
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      collection: { slug: string; itemCount: number };
    };
    expect(body.collection.itemCount).toBe(2);

    // Public IIIF endpoint reads without auth.
    const pub = await SELF.fetch(`http://test.local/iiif/collections/${body.collection.slug}`);
    expect(pub.status).toBe(200);
    const iiif = (await pub.json()) as {
      type: string;
      items: Array<{ type: string }>;
    };
    expect(iiif.type).toBe("Collection");
    expect(iiif.items.length).toBe(2);
  });
});
