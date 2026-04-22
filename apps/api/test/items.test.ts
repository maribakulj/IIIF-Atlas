/**
 * End-to-end coverage for the /api/items CRUD routes. The capture test
 * file covers the ingestion path itself; this file focuses on the
 * lifecycle that happens *after* an item exists: read, patch, soft
 * delete, restore, manifest generation, and workspace isolation.
 */

import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

async function createItem(
  auth: Awaited<ReturnType<typeof devSignup>>,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string; manifestSlug: string }> {
  const res = await SELF.fetch("http://test.local/api/captures", {
    method: "POST",
    headers: auth.authHeaders,
    body: JSON.stringify({
      pageUrl: "https://example.com/item",
      pageTitle: "Item",
      imageUrl: "https://example.com/item.jpg",
      mode: "reference",
      ...overrides,
    }),
  });
  if (res.status !== 201) throw new Error(`capture failed: ${await res.text()}`);
  const body = (await res.json()) as {
    item: { id: string; slug: string; manifestSlug: string };
  };
  return body.item;
}

describe("GET /api/items/:id", () => {
  it("returns the item with tags rolled up", async () => {
    const auth = await devSignup("get-item");
    const item = await createItem(auth);
    await SELF.fetch(`http://test.local/api/items/${item.id}/tags`, {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ name: "flagged" }),
    });
    const res = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: { id: string; tags: string[] } };
    expect(body.item.id).toBe(item.id);
    expect(body.item.tags).toContain("flagged");
  });

  it("accepts a slug as well as an id", async () => {
    const auth = await devSignup("get-item-slug");
    const item = await createItem(auth);
    const res = await SELF.fetch(`http://test.local/api/items/${item.slug}`, {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: { id: string } };
    expect(body.item.id).toBe(item.id);
  });

  it("returns 401 without an API key", async () => {
    const res = await SELF.fetch("http://test.local/api/items/abc");
    expect(res.status).toBe(401);
  });

  it("returns 404 for a non-existent id", async () => {
    const auth = await devSignup("get-item-missing");
    const res = await SELF.fetch("http://test.local/api/items/does-not-exist", {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/items/:id", () => {
  it("updates title, description, and rights", async () => {
    const auth = await devSignup("patch-item");
    const item = await createItem(auth);
    const res = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "PATCH",
      headers: auth.authHeaders,
      body: JSON.stringify({
        title: "Patched",
        description: "new desc",
        rights: "http://rightsstatements.org/vocab/InC/1.0/",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      item: { title: string; description: string | null; rights: string | null };
    };
    expect(body.item.title).toBe("Patched");
    expect(body.item.description).toBe("new desc");
    expect(body.item.rights).toMatch(/InC/);
  });

  it("invalidates the cached manifest JSON so it regenerates", async () => {
    const auth = await devSignup("patch-manifest");
    const item = await createItem(auth);

    // Seed a cached manifest.
    await SELF.fetch(`http://test.local/api/items/${item.id}/generate-manifest`, {
      method: "POST",
      headers: auth.authHeaders,
    });
    const before = await env.DB.prepare("SELECT manifest_json FROM items WHERE id = ?")
      .bind(item.id)
      .first<{ manifest_json: string | null }>();
    expect(before?.manifest_json).not.toBeNull();

    await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "PATCH",
      headers: auth.authHeaders,
      body: JSON.stringify({ title: "Title that forces rebuild" }),
    });

    const after = await env.DB.prepare("SELECT manifest_json FROM items WHERE id = ?")
      .bind(item.id)
      .first<{ manifest_json: string | null }>();
    expect(after?.manifest_json).toBeNull();
  });

  it("rejects an invalid mode value", async () => {
    const auth = await devSignup("patch-invalid");
    const item = await createItem(auth);
    const res = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "PATCH",
      headers: auth.authHeaders,
      body: JSON.stringify({ mode: "bogus" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an empty patch body", async () => {
    const auth = await devSignup("patch-empty");
    const item = await createItem(auth);
    const res = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "PATCH",
      headers: auth.authHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const auth = await devSignup("patch-bad-json");
    const item = await createItem(auth);
    const res = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "PATCH",
      headers: auth.authHeaders,
      body: "this is not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when patching another workspace's item", async () => {
    const owner = await devSignup("patch-owner");
    const stranger = await devSignup("patch-stranger");
    const item = await createItem(owner);
    const res = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "PATCH",
      headers: stranger.authHeaders,
      body: JSON.stringify({ title: "steal" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/items/:id/restore", () => {
  it("restores a soft-deleted item", async () => {
    const auth = await devSignup("restore-item");
    const item = await createItem(auth);
    await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });

    const restore = await SELF.fetch(`http://test.local/api/items/${item.id}/restore`, {
      method: "POST",
      headers: auth.authHeaders,
    });
    expect(restore.status).toBe(200);

    const get = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      headers: auth.authHeaders,
    });
    expect(get.status).toBe(200);
  });

  it("returns 404 when the item is not in the trash", async () => {
    const auth = await devSignup("restore-live");
    const item = await createItem(auth);
    const res = await SELF.fetch(`http://test.local/api/items/${item.id}/restore`, {
      method: "POST",
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/items/:id/generate-manifest", () => {
  it("builds and persists a manifest for a reference item", async () => {
    const auth = await devSignup("manifest-gen");
    const item = await createItem(auth, { pageTitle: "Generated" });
    const res = await SELF.fetch(`http://test.local/api/items/${item.id}/generate-manifest`, {
      method: "POST",
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      item: { id: string };
      manifestUrl: string;
    };
    expect(body.manifestUrl).toMatch(/\/iiif\/manifests\//);

    const row = await env.DB.prepare("SELECT manifest_json FROM items WHERE id = ?")
      .bind(item.id)
      .first<{ manifest_json: string | null }>();
    expect(row?.manifest_json).not.toBeNull();
    const m = JSON.parse(row?.manifest_json ?? "{}") as { type: string };
    expect(m.type).toBe("Manifest");
  });
});

describe("DELETE /api/items/:id", () => {
  it("returns 404 when deleting another workspace's item", async () => {
    const owner = await devSignup("del-owner");
    const stranger = await devSignup("del-stranger");
    const item = await createItem(owner);
    const res = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "DELETE",
      headers: stranger.authHeaders,
    });
    expect(res.status).toBe(404);

    // Confirm the item is still there for the owner.
    const check = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      headers: owner.authHeaders,
    });
    expect(check.status).toBe(200);
  });

  it("is idempotent: a second delete on the same id returns 404", async () => {
    const auth = await devSignup("del-twice");
    const item = await createItem(auth);
    const first = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    expect(first.status).toBe(204);
    const second = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    expect(second.status).toBe(404);
  });
});

describe("GET /api/items filters and pagination", () => {
  it("paginates with limit/offset and reports an accurate total", async () => {
    const auth = await devSignup("list-paging");
    for (let i = 0; i < 5; i++) {
      await createItem(auth, {
        pageUrl: `https://example.com/p${i}`,
        imageUrl: `https://example.com/p${i}.jpg`,
        pageTitle: `Item ${i}`,
      });
    }
    const res = await SELF.fetch("http://test.local/api/items?limit=2&offset=1", {
      headers: auth.authHeaders,
    });
    const body = (await res.json()) as {
      items: unknown[];
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.total).toBe(5);
    expect(body.items).toHaveLength(2);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
  });

  it("clamps limit to the documented maximum", async () => {
    const auth = await devSignup("list-clamp");
    const res = await SELF.fetch("http://test.local/api/items?limit=99999", {
      headers: auth.authHeaders,
    });
    const body = (await res.json()) as { limit: number };
    expect(body.limit).toBeLessThanOrEqual(200);
  });
});
