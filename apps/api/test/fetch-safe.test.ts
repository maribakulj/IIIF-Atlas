import { env, fetchMock } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { safeFetch, safeFetchJson } from "../src/fetch-safe.js";

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

describe("safeFetch", () => {
  it("rejects SSRF targets before making a request", async () => {
    await expect(
      safeFetch("http://127.0.0.1/foo", {
        timeoutMs: 1000,
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/blocked_private_ip/);
  });

  it("rejects disallowed schemes", async () => {
    await expect(
      safeFetch("file:///etc/passwd", { timeoutMs: 1000, maxBytes: 1024 }),
    ).rejects.toThrow(/blocked_scheme/);
  });

  it("enforces the MIME allow-list", async () => {
    fetchMock
      .get("https://ok.example")
      .intercept({ path: "/bad", method: "GET" })
      .reply(200, "x", { headers: { "content-type": "text/html" } });

    await expect(
      safeFetch("https://ok.example/bad", {
        timeoutMs: 1000,
        maxBytes: 1024,
        allowedMime: ["image/jpeg"],
      }),
    ).rejects.toThrow(/Disallowed MIME type/);
  });

  it("enforces content-length cap", async () => {
    fetchMock
      .get("https://ok.example")
      .intercept({ path: "/huge", method: "GET" })
      .reply(200, "x", {
        headers: { "content-type": "image/jpeg", "content-length": "10000" },
      });

    await expect(
      safeFetch("https://ok.example/huge", {
        timeoutMs: 1000,
        maxBytes: 100,
        allowedMime: ["image/jpeg"],
      }),
    ).rejects.toThrow(/exceeds size limit/);
  });

  it("reads the body and returns bytes", async () => {
    const payload = "ABCD"; // 4 ASCII bytes
    fetchMock
      .get("https://ok.example")
      .intercept({ path: "/small.jpg", method: "GET" })
      .reply(200, payload, {
        headers: { "content-type": "image/jpeg", "content-length": "4" },
      });

    const res = await safeFetch("https://ok.example/small.jpg", {
      timeoutMs: 1000,
      maxBytes: 1024,
      allowedMime: ["image/jpeg"],
    });
    expect(res.body.byteLength).toBe(4);
    expect(res.mime).toBe("image/jpeg");
  });
});

describe("safeFetchJson", () => {
  it("parses JSON with application/ld+json", async () => {
    fetchMock
      .get("https://iiif.example")
      .intercept({ path: "/m.json", method: "GET" })
      .reply(200, JSON.stringify({ hello: "world" }), {
        headers: { "content-type": "application/ld+json" },
      });
    const json = (await safeFetchJson("https://iiif.example/m.json", {
      timeoutMs: 1000,
      maxBytes: 1024,
    })) as { hello: string };
    expect(json.hello).toBe("world");
  });

  it("throws on non-JSON body", async () => {
    fetchMock
      .get("https://iiif.example")
      .intercept({ path: "/bad.json", method: "GET" })
      .reply(200, "not-json", {
        headers: { "content-type": "application/json" },
      });
    await expect(
      safeFetchJson("https://iiif.example/bad.json", {
        timeoutMs: 1000,
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/not valid JSON/);
  });
});

// env usage keeps TS happy and ensures bindings are present in setup.
export const _ = env;
