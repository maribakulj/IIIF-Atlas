/**
 * Bulk export tests. The happy-path CSV and RIS emissions are covered
 * in search.test.ts; this file rounds out the edge cases: JSON output,
 * filter interaction, workspace isolation, proper Content-Disposition.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

async function seed(auth: Awaited<ReturnType<typeof devSignup>>): Promise<void> {
  await SELF.fetch("http://test.local/api/captures", {
    method: "POST",
    headers: auth.authHeaders,
    body: JSON.stringify({
      pageUrl: "https://example.com/exp",
      pageTitle: "Export fixture",
      imageUrl: "https://example.com/exp.jpg",
      mode: "reference",
    }),
  });
}

describe("GET /api/export/items", () => {
  it("defaults to JSON format with a disposition header", async () => {
    const auth = await devSignup("export-json");
    await seed(auth);
    const res = await SELF.fetch("http://test.local/api/export/items", {
      headers: auth.authHeaders,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
    expect(res.headers.get("content-disposition") ?? "").toMatch(/filename=.*\.json/);
    const body = (await res.json()) as { items: Array<{ sourcePageUrl: string }> };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0]?.sourcePageUrl).toBe("https://example.com/exp");
  });

  it("isolates export output per workspace", async () => {
    const a = await devSignup("export-iso-a");
    const b = await devSignup("export-iso-b");
    await seed(a);
    const res = await SELF.fetch("http://test.local/api/export/items", {
      headers: b.authHeaders,
    });
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });

  it("applies list filters (mode) on export", async () => {
    const auth = await devSignup("export-filter");
    await seed(auth);
    const res = await SELF.fetch("http://test.local/api/export/items?mode=cached", {
      headers: auth.authHeaders,
    });
    const body = (await res.json()) as { items: unknown[] };
    // The seeded fixture is reference-mode, so cached filter returns nothing.
    expect(body.items).toHaveLength(0);
  });

  it("sets no-store cache control so downloads aren't cached by the browser", async () => {
    const auth = await devSignup("export-cache");
    await seed(auth);
    const res = await SELF.fetch("http://test.local/api/export/items?format=csv", {
      headers: auth.authHeaders,
    });
    expect(res.headers.get("cache-control") ?? "").toMatch(/no-store/);
  });

  it("CSV-escapes quotes and commas in titles", async () => {
    const auth = await devSignup("export-csv-escape");
    await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: auth.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/tricky",
        pageTitle: `Tricky, "quoted" title`,
        imageUrl: "https://example.com/tricky.jpg",
        mode: "reference",
      }),
    });
    const res = await SELF.fetch("http://test.local/api/export/items?format=csv", {
      headers: auth.authHeaders,
    });
    const text = await res.text();
    expect(text).toContain('"Tricky, ""quoted"" title"');
  });
});
