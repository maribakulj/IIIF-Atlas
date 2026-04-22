/**
 * GET /api/trash exposes tombstones for items and collections scoped to
 * the caller's workspace. The trash interaction with items is exercised
 * in hardening.test.ts; this file focuses on workspace isolation and
 * collection tombstones, which were untested.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

describe("GET /api/trash", () => {
  it("requires authentication", async () => {
    const res = await SELF.fetch("http://test.local/api/trash");
    expect(res.status).toBe(401);
  });

  it("lists deleted items and collections with tombstone timestamps", async () => {
    const auth = await devSignup("trash-list");
    // Capture + soft-delete an item.
    const cap = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/tr",
        imageUrl: "https://example.com/tr.jpg",
        mode: "reference",
      }),
    });
    const { item } = (await cap.json()) as { item: { id: string } };
    await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });

    // Create + soft-delete a collection.
    const col = await SELF.fetch("http://test.local/api/collections", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ title: "Trashed", isPublic: false }),
    });
    const { collection } = (await col.json()) as { collection: { id: string } };
    await SELF.fetch(`http://test.local/api/collections/${collection.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });

    const res = await SELF.fetch("http://test.local/api/trash", {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; deletedAt: string }>;
      collections: Array<{ id: string; deletedAt: string }>;
    };
    const trashedItem = body.items.find((i) => i.id === item.id);
    const trashedCol = body.collections.find((c) => c.id === collection.id);
    expect(trashedItem).toBeDefined();
    expect(trashedItem?.deletedAt).toBeTruthy();
    expect(trashedCol).toBeDefined();
    expect(trashedCol?.deletedAt).toBeTruthy();
  });

  it("scopes the trash to the caller's workspace", async () => {
    const owner = await devSignup("trash-own");
    const stranger = await devSignup("trash-stranger");
    const cap = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: owner.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/scope",
        imageUrl: "https://example.com/scope.jpg",
        mode: "reference",
      }),
    });
    const { item } = (await cap.json()) as { item: { id: string } };
    await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "DELETE",
      headers: owner.authHeaders,
    });

    const res = await SELF.fetch("http://test.local/api/trash", {
      headers: stranger.authHeaders,
    });
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.some((i) => i.id === item.id)).toBe(false);
  });
});
