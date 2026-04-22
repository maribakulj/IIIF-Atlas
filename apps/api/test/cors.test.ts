/**
 * End-to-end CORS checks. We exercise the preflight + the live response
 * wrapper through the public Worker surface rather than unit-testing
 * corsHeaders in isolation, because the header set is applied in several
 * places (router, R2 passthrough, error path).
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("CORS", () => {
  it("responds to OPTIONS preflight from an allowed origin with 204 + ACAO", async () => {
    const res = await SELF.fetch("http://test.local/api/items", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect(res.headers.get("access-control-allow-methods") ?? "").toMatch(/POST/);
    expect(res.headers.get("access-control-allow-headers") ?? "").toMatch(/Authorization/i);
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("matches wildcard patterns like chrome-extension://*", async () => {
    const res = await SELF.fetch("http://test.local/api/items", {
      method: "OPTIONS",
      headers: { origin: "chrome-extension://abcdef0123456789" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://abcdef0123456789",
    );
  });

  it("omits the allow-origin header for a disallowed origin", async () => {
    const res = await SELF.fetch("http://test.local/api/items", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example.com" },
    });
    // Preflight still returns 204 for cache-friendliness; the browser
    // itself aborts the follow-up request when ACAO is missing.
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("attaches CORS headers to error responses too", async () => {
    const res = await SELF.fetch("http://test.local/api/items", {
      headers: { origin: "http://localhost:5173" },
    });
    // 401 (no auth) — but the CORS header still has to be present or
    // the browser can't read the error body.
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("handles missing Origin (non-browser caller) without crashing", async () => {
    const res = await SELF.fetch("http://test.local/healthz");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
