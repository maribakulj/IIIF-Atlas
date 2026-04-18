import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const SHA = "deadbeef".repeat(8); // 64-char hex

beforeAll(async () => {
  // Pre-seed an asset row so the Image API has something to serve. We
  // don't put bytes into R2 here — the dimensions / metadata response
  // path is what we care about; the byte-streaming path is exercised
  // separately in the (currently skipped) cached-mode integration tests.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO assets (sha256, mime, byte_size, width, height, r2_key)
     VALUES (?,?,?,?,?,?)`,
  )
    .bind(SHA, "image/png", 4096, 2400, 1600, "fixtures/image.png")
    .run();
});

describe("GET /iiif/image/:id/info.json", () => {
  it("returns a level-0 info.json with the asset dimensions", async () => {
    const res = await SELF.fetch(`http://test.local/iiif/image/${SHA}/info.json`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/application\/ld\+json/);
    expect(res.headers.get("link") ?? "").toMatch(/level0/);

    const info = (await res.json()) as Record<string, unknown>;
    expect(info["@context"]).toMatch(/image\/3/);
    expect(info.type).toBe("ImageService3");
    expect(info.protocol).toBe("http://iiif.io/api/image");
    expect(info.profile).toBe("level0");
    expect(info.width).toBe(2400);
    expect(info.height).toBe(1600);
    expect(info.id).toMatch(new RegExp(`/iiif/image/${SHA}$`));
  });

  it("returns 404 for an unknown asset", async () => {
    const res = await SELF.fetch(`http://test.local/iiif/image/${"f".repeat(64)}/info.json`);
    expect(res.status).toBe(404);
  });
});

describe("GET /iiif/image/:id/{region}/{size}/{rotation}/{filename}", () => {
  it("rejects non-canonical region (level 0 only)", async () => {
    const res = await SELF.fetch(
      `http://test.local/iiif/image/${SHA}/0,0,100,100/max/0/default.png`,
    );
    expect(res.status).toBe(501);
    expect(await res.text()).toMatch(/region/);
  });

  it("rejects non-canonical size", async () => {
    const res = await SELF.fetch(`http://test.local/iiif/image/${SHA}/full/200,/0/default.png`);
    expect(res.status).toBe(501);
  });

  it("rejects non-zero rotation", async () => {
    const res = await SELF.fetch(`http://test.local/iiif/image/${SHA}/full/max/90/default.png`);
    expect(res.status).toBe(501);
  });

  it("rejects format conversion (asset is png, request jpg)", async () => {
    const res = await SELF.fetch(`http://test.local/iiif/image/${SHA}/full/max/0/default.jpg`);
    expect(res.status).toBe(501);
    expect(await res.text()).toMatch(/png/);
  });

  it("returns 404 when the asset row is missing entirely", async () => {
    const res = await SELF.fetch(
      `http://test.local/iiif/image/${"a".repeat(64)}/full/max/0/default.png`,
    );
    expect(res.status).toBe(404);
  });
});
