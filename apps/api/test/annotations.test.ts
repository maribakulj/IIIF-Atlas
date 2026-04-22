import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

let auth: Awaited<ReturnType<typeof devSignup>>;
let itemId: string;
let itemSlug: string;

beforeAll(async () => {
  auth = await devSignup("ann");
  const cap = await SELF.fetch("http://test.local/api/captures", {
    method: "POST",
    headers: auth.authHeaders,
    body: JSON.stringify({
      pageUrl: "https://example.com/annotated",
      pageTitle: "Annotated item",
      imageUrl: "https://example.com/annotated.jpg",
      mode: "reference",
    }),
  });
  const body = (await cap.json()) as { item: { id: string; slug: string; manifestSlug: string } };
  itemId = body.item.id;
  itemSlug = body.item.manifestSlug ?? body.item.slug;
});

describe("Annotations CRUD", () => {
  it("creates, lists, patches, and deletes an annotation", async () => {
    const created = await SELF.fetch(`http://test.local/api/items/${itemId}/annotations`, {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        motivation: "commenting",
        bodyValue: "Nice brushwork",
        targetXywh: "100,50,200,300",
      }),
    });
    expect(created.status).toBe(201);
    const { annotation } = (await created.json()) as {
      annotation: { id: string; bodyValue: string; targetXywh: string; motivation: string };
    };
    expect(annotation.bodyValue).toBe("Nice brushwork");
    expect(annotation.targetXywh).toBe("100,50,200,300");

    const list = await SELF.fetch(`http://test.local/api/items/${itemId}/annotations`, {
      headers: auth.authHeaders,
    });
    const listBody = (await list.json()) as { annotations: Array<{ id: string }> };
    expect(listBody.annotations.some((a) => a.id === annotation.id)).toBe(true);

    const patched = await SELF.fetch(`http://test.local/api/annotations/${annotation.id}`, {
      method: "PATCH",
      headers: auth.authHeaders,
      body: JSON.stringify({ bodyValue: "On second look: lovely composition." }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { annotation: { bodyValue: string } };
    expect(patchedBody.annotation.bodyValue).toBe("On second look: lovely composition.");

    const del = await SELF.fetch(`http://test.local/api/annotations/${annotation.id}`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    expect(del.status).toBe(204);
  });

  it("rejects a malformed xywh target", async () => {
    const res = await SELF.fetch(`http://test.local/api/items/${itemId}/annotations`, {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ bodyValue: "x", targetXywh: "not-xywh" }),
    });
    expect(res.status).toBe(400);
  });

  it("isolates annotations across workspaces", async () => {
    const outsider = await devSignup("ann-outsider");
    const res = await SELF.fetch(`http://test.local/api/items/${itemId}/annotations`, {
      headers: outsider.authHeaders,
    });
    // Outsider can't even resolve the item id in their workspace.
    expect(res.status).toBe(404);
  });
});

describe("GET /iiif/items/:slug/annotations (public)", () => {
  it("returns a IIIF AnnotationPage without auth", async () => {
    // Seed one annotation first.
    await SELF.fetch(`http://test.local/api/items/${itemId}/annotations`, {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ bodyValue: "publicly readable", targetXywh: "0,0,10,10" }),
    });

    const res = await SELF.fetch(`http://test.local/iiif/items/${itemSlug}/annotations`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/ld\+json/);
    const page = (await res.json()) as {
      "@context": string;
      type: string;
      items: Array<{
        type: string;
        motivation: string;
        target: string;
        body?: { value: string };
      }>;
    };
    expect(page.type).toBe("AnnotationPage");
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    const last = page.items[page.items.length - 1];
    expect(last?.target).toMatch(/#xywh=/);
    expect(last?.body?.value).toBe("publicly readable");
  });

  it("returns 404 for unknown slugs", async () => {
    const res = await SELF.fetch("http://test.local/iiif/items/does-not-exist/annotations");
    expect(res.status).toBe(404);
  });
});

describe("Annotations — error cases", () => {
  it("rejects an unknown motivation", async () => {
    const res = await SELF.fetch(`http://test.local/api/items/${itemId}/annotations`, {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ motivation: "vandalizing", bodyValue: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a bodyValue over the 16k character cap", async () => {
    const res = await SELF.fetch(`http://test.local/api/items/${itemId}/annotations`, {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ bodyValue: "x".repeat(16_001) }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when patching a non-existent annotation", async () => {
    const res = await SELF.fetch("http://test.local/api/annotations/does-not-exist", {
      method: "PATCH",
      headers: auth.authHeaders,
      body: JSON.stringify({ bodyValue: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when deleting a non-existent annotation", async () => {
    const res = await SELF.fetch("http://test.local/api/annotations/does-not-exist", {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(404);
  });

  it("isolates annotation patches across workspaces", async () => {
    const outsider = await devSignup("ann-iso-patch");
    const created = await SELF.fetch(`http://test.local/api/items/${itemId}/annotations`, {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ bodyValue: "owned" }),
    });
    const { annotation } = (await created.json()) as { annotation: { id: string } };
    const res = await SELF.fetch(`http://test.local/api/annotations/${annotation.id}`, {
      method: "PATCH",
      headers: outsider.authHeaders,
      body: JSON.stringify({ bodyValue: "hacked" }),
    });
    expect(res.status).toBe(404);
  });

  it("accepts an empty patch only when at least one field is set", async () => {
    const created = await SELF.fetch(`http://test.local/api/items/${itemId}/annotations`, {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ bodyValue: "seed" }),
    });
    const { annotation } = (await created.json()) as { annotation: { id: string } };
    const res = await SELF.fetch(`http://test.local/api/annotations/${annotation.id}`, {
      method: "PATCH",
      headers: auth.authHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
