/**
 * Unit tests for getLimits — the tiny parser that turns the comma-joined
 * string bindings into typed runtime limits. Worth covering because it
 * sits on the hot path for every capture and SSRF check.
 */

import { describe, expect, it } from "vitest";
import { getLimits } from "../src/env.js";
import type { Env } from "../src/env.js";

function shimEnv(overrides: Partial<Env>): Env {
  return {
    DB: {} as unknown as Env["DB"],
    BUCKET: {} as unknown as Env["BUCKET"],
    PUBLIC_BASE_URL: "http://test.local",
    ALLOWED_ORIGINS: "",
    MAX_DOWNLOAD_BYTES: "",
    FETCH_TIMEOUT_MS: "",
    ALLOWED_MIME_TYPES: "",
    ALLOW_DEV_SIGNUP: "false",
    ...overrides,
  };
}

describe("getLimits", () => {
  it("parses comma-separated origins, trimming whitespace and empties", async () => {
    const { allowedOrigins } = getLimits(
      shimEnv({
        ALLOWED_ORIGINS: " http://a.com , http://b.com,, http://c.com ",
      }),
    );
    expect(allowedOrigins).toEqual(["http://a.com", "http://b.com", "http://c.com"]);
  });

  it("lowercases the MIME allow-list", async () => {
    const { allowedMime } = getLimits(
      shimEnv({ ALLOWED_MIME_TYPES: "Image/JPEG, IMAGE/PNG, image/webp" }),
    );
    expect(allowedMime).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });

  it("falls back to sensible defaults when the numeric bindings are empty or invalid", async () => {
    const defaulted = getLimits(shimEnv({ MAX_DOWNLOAD_BYTES: "", FETCH_TIMEOUT_MS: "" }));
    expect(defaulted.maxBytes).toBe(25 * 1024 * 1024);
    expect(defaulted.fetchTimeoutMs).toBe(15000);

    const invalid = getLimits(
      shimEnv({ MAX_DOWNLOAD_BYTES: "not-a-number", FETCH_TIMEOUT_MS: "" }),
    );
    expect(invalid.maxBytes).toBe(25 * 1024 * 1024);
  });

  it("respects non-default numeric bindings", async () => {
    const custom = getLimits(shimEnv({ MAX_DOWNLOAD_BYTES: "1024", FETCH_TIMEOUT_MS: "500" }));
    expect(custom.maxBytes).toBe(1024);
    expect(custom.fetchTimeoutMs).toBe(500);
  });
});
