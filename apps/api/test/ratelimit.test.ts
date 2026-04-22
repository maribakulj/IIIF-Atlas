/**
 * Unit tests for the D1-backed token-bucket. Exercised via a tiny shim
 * Env that only exposes `DB`, so we don't need to go through the HTTP
 * surface to cover the bucket arithmetic edge cases.
 */

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { checkRateLimit } from "../src/ratelimit.js";

function key(prefix = "rl"): string {
  return `${prefix}:${Math.random().toString(36).slice(2)}`;
}

describe("checkRateLimit", () => {
  it("allows up to `capacity` requests in rapid succession", async () => {
    const k = key();
    let last: Awaited<ReturnType<typeof checkRateLimit>> | null = null;
    for (let i = 0; i < 5; i++) {
      last = await checkRateLimit(env as unknown as Env, k, 5, 1);
      expect(last.allowed).toBe(true);
    }
    expect(last?.remaining).toBeLessThan(5);
  });

  it("rejects the first request beyond capacity and reports a positive Retry-After", async () => {
    const k = key();
    // Drain the bucket.
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit(env as unknown as Env, k, 3, 0.1);
      expect(r.allowed).toBe(true);
    }
    const blocked = await checkRateLimit(env as unknown as Env, k, 3, 0.1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("tracks separate buckets per key", async () => {
    const a = key("a");
    const b = key("b");
    // Drain A completely.
    for (let i = 0; i < 2; i++) {
      await checkRateLimit(env as unknown as Env, a, 2, 0.01);
    }
    const aBlocked = await checkRateLimit(env as unknown as Env, a, 2, 0.01);
    expect(aBlocked.allowed).toBe(false);

    // B has its own capacity.
    const bOk = await checkRateLimit(env as unknown as Env, b, 2, 0.01);
    expect(bOk.allowed).toBe(true);
  });

  it("refills across the documented rate", async () => {
    const k = key();
    // Drain with capacity 1, refill 1/s.
    const first = await checkRateLimit(env as unknown as Env, k, 1, 1);
    expect(first.allowed).toBe(true);
    const blocked = await checkRateLimit(env as unknown as Env, k, 1, 1);
    expect(blocked.allowed).toBe(false);
    // Wait for the bucket to refill (retryAfter is in seconds).
    await new Promise((r) => setTimeout(r, (blocked.retryAfter ?? 1) * 1000 + 100));
    const after = await checkRateLimit(env as unknown as Env, k, 1, 1);
    expect(after.allowed).toBe(true);
  });

  it("Retry-After rounds up to at least 1 second", async () => {
    const k = key();
    // Deplete with a very fast refill so the deficit is <1s worth.
    await checkRateLimit(env as unknown as Env, k, 1, 10);
    const blocked = await checkRateLimit(env as unknown as Env, k, 1, 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
  });
});
