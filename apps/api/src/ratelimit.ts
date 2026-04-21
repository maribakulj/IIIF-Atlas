/**
 * D1-backed token bucket. Keyed by caller-chosen string (we use
 * `capture:<apiKeyId>`). One row per bucket in `rate_buckets`.
 *
 * We don't try to be cluster-coherent: D1 is eventually consistent across
 * regions, and a best-effort per-region bucket is fine for shielding us
 * from a single runaway API key. If two regions both let a request
 * through at the same instant, we just spent two tokens instead of one.
 */

import type { Env } from "./env.js";

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying. Only set when !allowed. */
  retryAfter?: number;
  remaining: number;
}

export async function checkRateLimit(
  env: Env,
  key: string,
  capacity: number,
  refillPerSecond: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const row = await env.DB.prepare(`SELECT tokens, refilled_at FROM rate_buckets WHERE key = ?`)
    .bind(key)
    .first<{ tokens: number; refilled_at: string }>();

  let tokens = capacity;
  if (row) {
    const last = Date.parse(row.refilled_at);
    const elapsedSec = Math.max(0, (now - last) / 1000);
    tokens = Math.min(capacity, row.tokens + elapsedSec * refillPerSecond);
  }

  if (tokens < 1) {
    const deficit = 1 - tokens;
    const retryAfter = Math.max(1, Math.ceil(deficit / refillPerSecond));
    // Persist the refill we've accumulated so the next call sees a fresh clock.
    await env.DB.prepare(
      `INSERT INTO rate_buckets (key, tokens, refilled_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET tokens = excluded.tokens, refilled_at = excluded.refilled_at`,
    )
      .bind(key, tokens, nowIso)
      .run();
    return { allowed: false, retryAfter, remaining: 0 };
  }

  const remaining = tokens - 1;
  await env.DB.prepare(
    `INSERT INTO rate_buckets (key, tokens, refilled_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET tokens = excluded.tokens, refilled_at = excluded.refilled_at`,
  )
    .bind(key, remaining, nowIso)
    .run();
  return { allowed: true, remaining };
}
