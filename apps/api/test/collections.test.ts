/**
 * Collections CRUD: create, read, patch, soft-delete, restore. The public
 * /iiif/collections/:slug path is lightly exercised in captures.test.ts;
 * here we focus on the authenticated workspace-scoped surface plus the
 * isolation guarantees that keep workspace boundaries tight.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

async function createCollection(
  auth: Awaited<ReturnType<typeof devSignup>>,
  body: Record<string, unknown> = {},
): Promise<{ id: string; slug: string; isPublic: boolean; itemIds: string[] }> {
  const res = await SELF.fetch("http://test.local/api/collections", {
    method: "POST",
    headers: auth.authHeaders,
    body: JSON.stringify({ title: "Test collection", ...body }),
  });
  if (res.status !== 201) throw new Error(`collection create failed: ${await res.text()}`);
  const json = (await res.json()) as {
    collection: {
      id: string;
      slug: string;
      isPublic: boolean;
      items: Array<{ id: string }>;
    };
  };
  return {
    id: json.collection.id,
    slug: json.collection.slug,
    isPublic: json.collection.isPublic,
    itemIds: json.collection.items.map((i) => i.id),
  };
}

async function createItem(
  auth: Awaited<ReturnType<typeof devSignup>>,
  hint: string,
): Promise<{ id: string }> {
  const res = await SELF.fetch("http://test.local/api/captures", {
    method: "POST",
    headers: auth.authHeaders,
    body: JSON.stringify({
      pageUrl: `https://example.com/${hint}`,
      imageUrl: `https://example.com/${hint}.jpg`,
      mode: "reference",
    }),
  });
  const body = (await res.json()) as { item: { id: string } };
  return { id: body.item.id };
}

describe("POST /api/collections", () => {
  it("defaults to public when isPublic is omitted", async () => {
    const auth = await devSignup("col-default-public");
    const col = await createCollection(auth, { title: "Public default" });
    expect(col.isPublic).toBe(true);
  });

  it("respects isPublic=false and hides the collection from the public URL", async () => {
    const auth = await devSignup("col-private");
    const col = await createCollection(auth, {
      title: "Private",
      isPublic: false,
    });
    const pub = await SELF.fetch(`http://test.local/iiif/collections/${col.slug}`);
    expect(pub.status).toBe(404);
  });

  it("attaches only items owned by the caller's workspace", async () => {
    const owner = await devSignup("col-attach-owner");
    const stranger = await devSignup("col-attach-stranger");
    const mine = await createItem(owner, "mine");
    const theirs = await createItem(stranger, "theirs");

    const col = await createCollection(owner, {
      title: "Mixed",
      itemIds: [mine.id, theirs.id],
    });
    expect(col.itemIds).toEqual([mine.id]);
  });

  it("rejects an empty title", async () => {
    const auth = await devSignup("col-empty-title");
    const res = await SELF.fetch("http://test.local/api/collections", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ title: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await SELF.fetch("http://test.local/api/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/collections/:id", () => {
  it("returns the collection and its items in position order", async () => {
    const auth = await devSignup("col-get");
    const a = await createItem(auth, "a");
    const b = await createItem(auth, "b");
    const c = await createItem(auth, "c");
    const col = await createCollection(auth, { itemIds: [c.id, a.id, b.id] });

    const res = await SELF.fetch(`http://test.local/api/collections/${col.id}`, {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collection: { items: Array<{ id: string }> };
    };
    expect(body.collection.items.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
  });

  it("isolates cross-workspace access: stranger gets 404", async () => {
    const owner = await devSignup("col-iso-owner");
    const stranger = await devSignup("col-iso-stranger");
    const col = await createCollection(owner);
    const res = await SELF.fetch(`http://test.local/api/collections/${col.id}`, {
      headers: stranger.authHeaders,
    });
    expect(res.status).toBe(404);
  });

  it("looks up by slug as well", async () => {
    const auth = await devSignup("col-slug");
    const col = await createCollection(auth, { title: "By Slug" });
    const res = await SELF.fetch(`http://test.local/api/collections/${col.slug}`, {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/collections/:id", () => {
  it("updates metadata and can flip visibility", async () => {
    const auth = await devSignup("col-patch");
    const col = await createCollection(auth, { title: "First", isPublic: false });

    const res = await SELF.fetch(`http://test.local/api/collections/${col.id}`, {
      method: "PATCH",
      headers: auth.authHeaders,
      body: JSON.stringify({ title: "Second", description: "d", isPublic: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collection: { title: string; description: string | null; isPublic: boolean };
    };
    expect(body.collection.title).toBe("Second");
    expect(body.collection.description).toBe("d");
    expect(body.collection.isPublic).toBe(true);

    // Public URL now resolves.
    const pub = await SELF.fetch(`http://test.local/iiif/collections/${col.slug}`);
    expect(pub.status).toBe(200);
  });

  it("replaces the item set when itemIds is provided", async () => {
    const auth = await devSignup("col-patch-items");
    const a = await createItem(auth, "ra");
    const b = await createItem(auth, "rb");
    const c = await createItem(auth, "rc");
    const col = await createCollection(auth, { itemIds: [a.id, b.id] });

    const res = await SELF.fetch(`http://test.local/api/collections/${col.id}`, {
      method: "PATCH",
      headers: auth.authHeaders,
      body: JSON.stringify({ itemIds: [c.id] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collection: { items: Array<{ id: string }> };
    };
    expect(body.collection.items.map((i) => i.id)).toEqual([c.id]);
  });

  it("rejects patches from a different workspace with 404", async () => {
    const owner = await devSignup("col-patch-owner");
    const stranger = await devSignup("col-patch-stranger");
    const col = await createCollection(owner);
    const res = await SELF.fetch(`http://test.local/api/collections/${col.id}`, {
      method: "PATCH",
      headers: stranger.authHeaders,
      body: JSON.stringify({ title: "hijack" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/collections/:id/restore", () => {
  it("restores a soft-deleted collection", async () => {
    const auth = await devSignup("col-restore");
    const col = await createCollection(auth, { isPublic: true });
    await SELF.fetch(`http://test.local/api/collections/${col.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    const restore = await SELF.fetch(`http://test.local/api/collections/${col.id}/restore`, {
      method: "POST",
      headers: auth.authHeaders,
    });
    expect(restore.status).toBe(200);
    const pub = await SELF.fetch(`http://test.local/iiif/collections/${col.slug}`);
    expect(pub.status).toBe(200);
  });

  it("returns 404 when the collection is not in trash", async () => {
    const auth = await devSignup("col-restore-live");
    const col = await createCollection(auth);
    const res = await SELF.fetch(`http://test.local/api/collections/${col.id}/restore`, {
      method: "POST",
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(404);
  });
});

describe("listCollections filters out soft-deleted rows", () => {
  it("hides deleted collections from the workspace list", async () => {
    const auth = await devSignup("col-list-filter");
    const alive = await createCollection(auth, { title: "Alive" });
    const doomed = await createCollection(auth, { title: "Doomed" });
    await SELF.fetch(`http://test.local/api/collections/${doomed.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    const res = await SELF.fetch("http://test.local/api/collections", {
      headers: auth.authHeaders,
    });
    const body = (await res.json()) as { collections: Array<{ id: string }> };
    const ids = body.collections.map((c) => c.id);
    expect(ids).toContain(alive.id);
    expect(ids).not.toContain(doomed.id);
  });
});
