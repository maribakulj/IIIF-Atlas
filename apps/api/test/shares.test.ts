import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

let auth: Awaited<ReturnType<typeof devSignup>>;
let collectionId: string;

beforeAll(async () => {
  auth = await devSignup("shares");
  // Seed 2 items + a collection that groups them.
  const ids: string[] = [];
  for (const i of [1, 2]) {
    const cap = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: `https://example.com/s/${i}`,
        imageUrl: `https://example.com/s/${i}.jpg`,
        mode: "reference",
      }),
    });
    const body = (await cap.json()) as { item: { id: string } };
    ids.push(body.item.id);
  }
  const col = await SELF.fetch("http://test.local/api/collections", {
    method: "POST",
    headers: auth.authHeaders,
    body: JSON.stringify({ title: "Shareable", itemIds: ids }),
  });
  const colBody = (await col.json()) as { collection: { id: string } };
  collectionId = colBody.collection.id;
});

describe("Share tokens", () => {
  it("mints, resolves, and revokes a collection viewer share", async () => {
    const create = await SELF.fetch("http://test.local/api/shares", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        resourceType: "collection",
        resourceId: collectionId,
        role: "viewer",
      }),
    });
    expect(create.status).toBe(201);
    const { share } = (await create.json()) as {
      share: { id: string; secret: string; prefix: string; role: string };
    };
    expect(share.secret.startsWith("iia_share_")).toBe(true);
    expect(share.role).toBe("viewer");

    // Public resolve with no Authorization header.
    const resolve = await SELF.fetch(`http://test.local/api/shares/${share.secret}`);
    expect(resolve.status).toBe(200);
    const body = (await resolve.json()) as {
      resourceType: string;
      role: string;
      collection?: { id: string; items: Array<{ id: string }> };
    };
    expect(body.resourceType).toBe("collection");
    expect(body.role).toBe("viewer");
    expect(body.collection?.id).toBe(collectionId);
    expect(body.collection?.items.length).toBe(2);

    // List via the owner's workspace.
    const list = await SELF.fetch(
      `http://test.local/api/shares?resourceType=collection&resourceId=${collectionId}`,
      { headers: auth.authHeaders },
    );
    const listBody = (await list.json()) as { shares: Array<{ id: string }> };
    expect(listBody.shares.some((s) => s.id === share.id)).toBe(true);

    // Revoke; the public resolve flips to 404.
    const del = await SELF.fetch(`http://test.local/api/shares/${share.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    expect(del.status).toBe(204);

    const probe = await SELF.fetch(`http://test.local/api/shares/${share.secret}`);
    expect(probe.status).toBe(404);
  });

  it("refuses to mint a share for another workspace's resource", async () => {
    const outsider = await devSignup("shares-outsider");
    const res = await SELF.fetch("http://test.local/api/shares", {
      method: "POST",
      headers: outsider.authHeaders,
      body: JSON.stringify({
        resourceType: "collection",
        resourceId: collectionId,
        role: "viewer",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an invalid/expired token shape", async () => {
    const res = await SELF.fetch("http://test.local/api/shares/not-a-share-token");
    expect(res.status).toBe(404);
  });
});
