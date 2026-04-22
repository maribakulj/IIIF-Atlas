import { SELF, env, fetchMock } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

let auth: Awaited<ReturnType<typeof devSignup>>;

beforeAll(async () => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
  auth = await devSignup("ingest");
});

/**
 * Build a minimal real PNG header (8-byte signature + IHDR chunk) followed
 * by `padding` zero bytes so the body has a meaningful Content-Length and a
 * stable SHA-256 keyed by `(width, height, padding)`.
 */
function pngBytes(width: number, height: number, padding: number): Uint8Array {
  const header = new Uint8Array(8 + 8 + 13);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  header.set([0, 0, 0, 13], 8);
  header.set([0x49, 0x48, 0x44, 0x52], 12);
  header.set(
    [(width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff],
    16,
  );
  header.set(
    [(height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff],
    20,
  );
  const out = new Uint8Array(header.length + padding);
  out.set(header, 0);
  return out;
}

function mockPng(url: string, body: Uint8Array) {
  const u = new URL(url);
  // undici MockAgent accepts Buffer for raw bytes; fall back to an ASCII
  // string when running outside Node (kept defensive).
  const buf = typeof Buffer !== "undefined" ? Buffer.from(body) : String.fromCharCode(...body);
  fetchMock
    .get(u.origin)
    .intercept({ path: u.pathname + u.search, method: "GET" })
    .reply(200, buf, {
      headers: { "content-type": "image/png", "content-length": String(body.byteLength) },
    });
}

describe("cached mode end-to-end (sync fallback)", () => {
  it("creates a 'ready' item with probed dimensions and stores the asset", async () => {
    const body = pngBytes(2400, 1600, 32);
    const url = "https://cdn.example.com/dim/one.png";
    mockPng(url, body);

    const res = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/dim",
        imageUrl: url,
        mode: "cached",
      }),
    });
    expect(res.status).toBe(201); // sync path => 201, not 202
    const json = (await res.json()) as {
      item: { status: string; width: number; height: number; r2Key: string; assetSha256: string };
    };
    expect(json.item.status).toBe("ready");
    expect(json.item.width).toBe(2400);
    expect(json.item.height).toBe(1600);
    expect(json.item.r2Key).toMatch(/^items\//);

    const obj = await env.BUCKET.get(json.item.r2Key);
    expect(obj?.size).toBe(body.byteLength);
  });

  it("dedupes by SHA-256: a second capture of the same bytes shares the asset", async () => {
    const body = pngBytes(640, 480, 64);
    const url1 = "https://cdn.example.com/dedup/a.png";
    const url2 = "https://cdn.example.com/dedup/b.png";
    mockPng(url1, body);
    mockPng(url2, body);

    const r1 = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ pageUrl: "https://example.com/a", imageUrl: url1, mode: "cached" }),
    });
    const r2 = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ pageUrl: "https://example.com/b", imageUrl: url2, mode: "cached" }),
    });
    const i1 = (await r1.json()) as { item: { assetSha256: string; r2Key: string } };
    const i2 = (await r2.json()) as { item: { assetSha256: string; r2Key: string } };
    expect(i1.item.assetSha256).toBeTruthy();
    expect(i2.item.assetSha256).toBe(i1.item.assetSha256);
    expect(i2.item.r2Key).toBe(i1.item.r2Key);
  });
});

describe("retry endpoint", () => {
  it("rejects retry on a non-cached item", async () => {
    const cap = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/ref",
        imageUrl: "https://example.com/ref.jpg",
        mode: "reference",
      }),
    });
    const created = (await cap.json()) as { item: { id: string } };
    const retry = await SELF.fetch(`http://test.local/api/items/${created.item.id}/retry`, {
      method: "POST",
      headers: auth.authHeaders,
    });
    expect(retry.status).toBe(422);
  });

  it("rejects retry from a different workspace", async () => {
    const otherCap = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/cross",
        imageUrl: "https://example.com/cross.jpg",
        mode: "reference",
      }),
    });
    const created = (await otherCap.json()) as { item: { id: string } };

    const stranger = await devSignup("ingest-stranger");
    const r = await SELF.fetch(`http://test.local/api/items/${created.item.id}/retry`, {
      method: "POST",
      headers: stranger.authHeaders,
    });
    expect(r.status).toBe(404);
  });
});
