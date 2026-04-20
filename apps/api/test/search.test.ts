import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

let auth: Awaited<ReturnType<typeof devSignup>>;

async function capture(
  authed: typeof auth,
  body: Record<string, unknown>,
): Promise<{ id: string; slug: string }> {
  const res = await SELF.fetch("http://test.local/api/captures", {
    method: "POST",
    headers: authed.authHeaders,
    body: JSON.stringify(body),
  });
  if (res.status !== 201) throw new Error(`capture failed: ${await res.text()}`);
  const json = (await res.json()) as { item: { id: string; slug: string } };
  return json.item;
}

beforeAll(async () => {
  auth = await devSignup("search");
  await capture(auth, {
    pageUrl: "https://example.com/history",
    pageTitle: "A short history of cuneiform tablets",
    imageUrl: "https://example.com/cuneiform.jpg",
    mode: "reference",
  });
  await capture(auth, {
    pageUrl: "https://example.com/art",
    pageTitle: "Renaissance painters of Venice",
    imageUrl: "https://example.com/venice.jpg",
    mode: "reference",
  });
  await capture(auth, {
    pageUrl: "https://example.com/photo",
    pageTitle: "Early color photography",
    imageUrl: "https://example.com/color.jpg",
    mode: "reference",
  });
});

describe("GET /api/items?q=… (FTS5)", () => {
  it("matches a term in source_page_title", async () => {
    const res = await SELF.fetch("http://test.local/api/items?q=cuneiform", {
      headers: auth.authHeaders,
    });
    const body = (await res.json()) as {
      items: Array<{ sourcePageTitle: string }>;
      total: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items.some((i) => /cuneiform/i.test(i.sourcePageTitle ?? ""))).toBe(true);
  });

  it("supports prefix-style matching (as-you-type)", async () => {
    const res = await SELF.fetch("http://test.local/api/items?q=renai", {
      headers: auth.authHeaders,
    });
    const body = (await res.json()) as { total: number };
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("strips FTS reserved characters from the query", async () => {
    const res = await SELF.fetch(
      `http://test.local/api/items?q=${encodeURIComponent('"Venice*()')}`,
      { headers: auth.authHeaders },
    );
    expect(res.status).toBe(200);
  });

  it("honors sort=title_asc", async () => {
    const res = await SELF.fetch("http://test.local/api/items?sort=title_asc", {
      headers: auth.authHeaders,
    });
    const body = (await res.json()) as { items: Array<{ title: string | null; slug: string }> };
    const keys = body.items.map((i) => (i.title ?? i.slug).toLowerCase());
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it("reports facet counts when requested", async () => {
    const res = await SELF.fetch("http://test.local/api/items?facets=1", {
      headers: auth.authHeaders,
    });
    const body = (await res.json()) as {
      facets: { mode: Array<{ value: string; count: number }>; tag: unknown[] };
    };
    expect(body.facets).toBeDefined();
    const ref = body.facets.mode.find((f) => f.value === "reference");
    expect(ref?.count).toBeGreaterThanOrEqual(3);
  });
});

describe("Tags", () => {
  it("adds, lists, filters by, and removes a tag", async () => {
    // Seed an item we'll tag.
    const target = await capture(auth, {
      pageUrl: "https://example.com/tagged",
      pageTitle: "Tagged item",
      imageUrl: "https://example.com/tagged.jpg",
      mode: "reference",
    });

    const add = await SELF.fetch(`http://test.local/api/items/${target.id}/tags`, {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({ name: "Ancient!!" }),
    });
    expect(add.status).toBe(201);
    const addBody = (await add.json()) as { tag: { slug: string } };
    expect(addBody.tag.slug).toBe("ancient");

    const listTags = await SELF.fetch("http://test.local/api/tags", {
      headers: auth.authHeaders,
    });
    const tagsBody = (await listTags.json()) as {
      tags: Array<{ slug: string; itemCount: number }>;
    };
    expect(tagsBody.tags.some((t) => t.slug === "ancient" && t.itemCount === 1)).toBe(true);

    const filtered = await SELF.fetch("http://test.local/api/items?tag=ancient", {
      headers: auth.authHeaders,
    });
    const filteredBody = (await filtered.json()) as {
      items: Array<{ id: string; tags: string[] }>;
    };
    expect(filteredBody.items.some((i) => i.id === target.id)).toBe(true);
    expect(filteredBody.items[0]?.tags).toContain("ancient");

    const del = await SELF.fetch(`http://test.local/api/items/${target.id}/tags/ancient`, {
      method: "DELETE",
      headers: auth.authHeaders,
    });
    expect(del.status).toBe(204);

    const after = await SELF.fetch("http://test.local/api/items?tag=ancient", {
      headers: auth.authHeaders,
    });
    const afterBody = (await after.json()) as { total: number };
    expect(afterBody.total).toBe(0);
  });

  it("isolates tags across workspaces", async () => {
    const outsider = await devSignup("search-outsider");
    const res = await SELF.fetch("http://test.local/api/tags", {
      headers: outsider.authHeaders,
    });
    const body = (await res.json()) as { tags: Array<{ slug: string }> };
    expect(body.tags.some((t) => t.slug === "ancient")).toBe(false);
  });
});

describe("Export", () => {
  it("streams CSV with one header row + one line per item", async () => {
    const res = await SELF.fetch("http://test.local/api/export/items?format=csv", {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/csv/);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toContain("id,slug,title");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("streams RIS with TY / ER markers per record", async () => {
    const res = await SELF.fetch("http://test.local/api/export/items?format=ris", {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/TY {2}- ART/);
    expect(text).toMatch(/ER {2}- /);
  });

  it("rejects unknown formats", async () => {
    const res = await SELF.fetch("http://test.local/api/export/items?format=xml", {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(400);
  });

  it("requires auth", async () => {
    const res = await SELF.fetch("http://test.local/api/export/items?format=csv");
    expect(res.status).toBe(401);
  });
});
