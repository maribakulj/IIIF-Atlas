import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

describe("Audit log", () => {
  it("appends an item.create row on capture", async () => {
    const auth = await devSignup("audit");
    const cap = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/audit",
        imageUrl: "https://example.com/audit.jpg",
        mode: "reference",
      }),
    });
    expect(cap.status).toBe(201);
    const { item } = (await cap.json()) as { item: { id: string } };

    const row = await env.DB.prepare(
      `SELECT verb, subject_type, subject_id, actor_user_id, workspace_id
         FROM audit_log
        WHERE subject_id = ? AND verb = 'item.create'`,
    )
      .bind(item.id)
      .first<{
        verb: string;
        subject_type: string;
        subject_id: string;
        actor_user_id: string;
        workspace_id: string;
      }>();
    expect(row).not.toBeNull();
    expect(row?.subject_type).toBe("item");
    expect(row?.actor_user_id).toBe(auth.userId);
    expect(row?.workspace_id).toBe(auth.workspaceId);
  });
});

describe("Soft delete + trash", () => {
  it("hides soft-deleted items from list and restores via /restore", async () => {
    const auth = await devSignup("trash");
    const cap = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/t",
        imageUrl: "https://example.com/t.jpg",
        mode: "reference",
      }),
    });
    const { item } = (await cap.json()) as { item: { id: string; slug: string } };

    const del = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    expect(del.status).toBe(204);

    // GET /api/items/:id now 404s.
    const gone = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      headers: auth.authHeaders,
    });
    expect(gone.status).toBe(404);

    // Public IIIF manifest also 404s.
    const manifest = await SELF.fetch(`http://test.local/iiif/manifests/${item.slug}`);
    expect(manifest.status).toBe(404);

    // /api/trash exposes the tombstone.
    const trashRes = await SELF.fetch("http://test.local/api/trash", {
      headers: auth.authHeaders,
    });
    expect(trashRes.status).toBe(200);
    const trash = (await trashRes.json()) as { items: Array<{ id: string }> };
    expect(trash.items.some((i) => i.id === item.id)).toBe(true);

    // Restore + re-fetch.
    const restore = await SELF.fetch(`http://test.local/api/items/${item.id}/restore`, {
      method: "POST",
      headers: auth.authHeaders,
    });
    expect(restore.status).toBe(200);
    const back = await SELF.fetch(`http://test.local/api/items/${item.id}`, {
      headers: auth.authHeaders,
    });
    expect(back.status).toBe(200);
  });

  it("hides soft-deleted collections from list + public manifest", async () => {
    const auth = await devSignup("trash-col");
    const col = await SELF.fetch("http://test.local/api/collections", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ title: "Doomed", isPublic: true }),
    });
    const { collection } = (await col.json()) as { collection: { id: string; slug: string } };

    await SELF.fetch(`http://test.local/api/collections/${collection.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    const list = await SELF.fetch("http://test.local/api/collections", {
      headers: auth.authHeaders,
    });
    const body = (await list.json()) as { collections: Array<{ id: string }> };
    expect(body.collections.some((c) => c.id === collection.id)).toBe(false);

    const pub = await SELF.fetch(`http://test.local/iiif/collections/${collection.slug}`);
    expect(pub.status).toBe(404);
  });
});

describe("Rate limit on POST /api/captures", () => {
  // Bucket capacity is 30; 31st request in the same second trips 429.
  it("returns 429 with Retry-After when the bucket is empty", async () => {
    const auth = await devSignup("ratelimit");
    let lastStatus = 0;
    let retryAfter: string | null = null;
    for (let i = 0; i < 35; i++) {
      const res = await SELF.fetch("http://test.local/api/captures", {
        method: "POST",
        headers: auth.authHeaders,
        body: JSON.stringify({
          pageUrl: `https://example.com/r${i}`,
          imageUrl: `https://example.com/r${i}.jpg`,
          mode: "reference",
        }),
      });
      lastStatus = res.status;
      if (res.status === 429) {
        retryAfter = res.headers.get("retry-after");
        break;
      }
    }
    expect(lastStatus).toBe(429);
    expect(retryAfter).not.toBeNull();
    expect(Number.parseInt(retryAfter ?? "0", 10)).toBeGreaterThan(0);
  });
});

describe("GET /api/workspaces/current/usage", () => {
  it("returns rolled-up counts for the caller's workspace", async () => {
    const auth = await devSignup("usage");
    await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/u",
        imageUrl: "https://example.com/u.jpg",
        mode: "reference",
      }),
    });
    await SELF.fetch("http://test.local/api/collections", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ title: "Usage" }),
    });
    const res = await SELF.fetch("http://test.local/api/workspaces/current/usage", {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: number;
      collections: number;
      annotations: number;
      activeShares: number;
      assetBytes: number;
    };
    expect(body.items).toBeGreaterThanOrEqual(1);
    expect(body.collections).toBeGreaterThanOrEqual(1);
    expect(typeof body.assetBytes).toBe("number");
  });
});
