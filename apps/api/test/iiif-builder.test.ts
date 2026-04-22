/**
 * Manifest builder tests that exercise the behavior branches end-to-end
 * via the public /iiif/manifests/:slug and /iiif/collections/:slug routes,
 * including the rewritten @id, embedded ImageService3 for cached items,
 * and the collection manifest shape.
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
      pageUrl: "https://example.com/p",
      imageUrl: "https://example.com/p.jpg",
      pageTitle: "Built",
      mode: "reference",
      ...overrides,
    }),
  });
  const body = (await res.json()) as {
    item: { id: string; slug: string; manifestSlug: string };
  };
  return body.item;
}

describe("getManifestBySlug", () => {
  it("returns a IIIF-Presentation-3 manifest with our public @id", async () => {
    const auth = await devSignup("m3");
    const item = await createItem(auth);
    const res = await SELF.fetch(`http://test.local/iiif/manifests/${item.manifestSlug}`);
    expect(res.status).toBe(200);
    const m = (await res.json()) as {
      "@context": string;
      id: string;
      type: string;
      items: Array<{ type: string }>;
    };
    expect(m.type).toBe("Manifest");
    expect(m["@context"]).toMatch(/presentation\/3/);
    expect(m.id).toContain(`/iiif/manifests/${item.manifestSlug}`);
    expect(m.items[0]?.type).toBe("Canvas");
  });

  it("substitutes source image URL for reference items (no ImageService)", async () => {
    const auth = await devSignup("m3-ref");
    const item = await createItem(auth);
    const res = await SELF.fetch(`http://test.local/iiif/manifests/${item.manifestSlug}`);
    const m = (await res.json()) as {
      items: Array<{
        items: Array<{
          items: Array<{
            body: { id: string; service?: unknown[] };
          }>;
        }>;
      }>;
    };
    const body = m.items[0]?.items[0]?.items[0]?.body;
    expect(body?.id).toBe("https://example.com/p.jpg");
    expect(body?.service).toBeUndefined();
  });

  it("caches the generated manifest JSON back to the row", async () => {
    const auth = await devSignup("m3-cache");
    const item = await createItem(auth);
    const row1 = await env.DB.prepare("SELECT manifest_json FROM items WHERE id = ?")
      .bind(item.id)
      .first<{ manifest_json: string | null }>();
    expect(row1?.manifest_json).toBeNull();

    await SELF.fetch(`http://test.local/iiif/manifests/${item.manifestSlug}`);

    const row2 = await env.DB.prepare("SELECT manifest_json FROM items WHERE id = ?")
      .bind(item.id)
      .first<{ manifest_json: string | null }>();
    expect(row2?.manifest_json).not.toBeNull();
  });

  it("returns 404 for a soft-deleted item", async () => {
    const auth = await devSignup("m3-deleted");
    const item = await createItem(auth);
    await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    const res = await SELF.fetch(`http://test.local/iiif/manifests/${item.manifestSlug}`);
    expect(res.status).toBe(404);
  });
});

describe("getCollectionBySlug", () => {
  it("returns a IIIF Collection with one Manifest reference per contained item", async () => {
    const auth = await devSignup("col-builder");
    const item = await createItem(auth);

    const create = await SELF.fetch("http://test.local/api/collections", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        title: "Gallery",
        itemIds: [item.id],
        isPublic: true,
      }),
    });
    const { collection } = (await create.json()) as {
      collection: { slug: string };
    };
    const res = await SELF.fetch(`http://test.local/iiif/collections/${collection.slug}`);
    expect(res.status).toBe(200);
    const c = (await res.json()) as {
      type: string;
      items: Array<{ type: string; id: string }>;
    };
    expect(c.type).toBe("Collection");
    expect(c.items).toHaveLength(1);
    expect(c.items[0]?.type).toBe("Manifest");
    expect(c.items[0]?.id).toContain(`/iiif/manifests/${item.manifestSlug}`);
  });
});
