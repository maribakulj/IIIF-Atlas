/**
 * Ingestion pipeline for `mode = 'cached'` items.
 *
 * Invoked either:
 *  - from the queue consumer (`queue()` export in index.ts), one message
 *    per item, or
 *  - inline from `enqueueIngest` when no `INGEST_QUEUE` binding is
 *    available (tests, single-instance dev). Same code path either way.
 *
 * Algorithm:
 *  1. Load the item; bail with status='failed' if missing or bad source.
 *  2. safeFetch the source image (SSRF + size + MIME guards still apply).
 *  3. Compute SHA-256 of the bytes.
 *  4. Look up `assets` by sha256:
 *      - hit  → reuse the existing R2 object, skip the put.
 *      - miss → probe dimensions, R2.put, INSERT INTO assets.
 *  5. Update the item: r2_key, mime, byte_size, width, height,
 *     asset_sha256, status='ready', error_message=NULL.
 *
 * Failures set status='failed' and error_message; the item stays in the
 * library so the user can retry.
 */

import { getLimits } from "./env.js";
import type { Env } from "./env.js";
import { safeFetch } from "./fetch-safe.js";
import { probeImage } from "./image-probe.js";
import { buildR2Key, putImage } from "./r2.js";

interface ItemForIngest {
  id: string;
  source_image_url: string | null;
  workspace_id: string | null;
  mode: string;
}

interface AssetRow {
  sha256: string;
  mime: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  r2_key: string;
}

export async function processIngestJob(env: Env, itemId: string): Promise<void> {
  const item = await env.DB.prepare(
    `SELECT id, source_image_url, workspace_id, mode FROM items WHERE id = ?`,
  )
    .bind(itemId)
    .first<ItemForIngest>();
  if (!item) return; // Item was deleted before we got to it.

  if (item.mode !== "cached") {
    // Defensive: only cached items go through ingest.
    await markReady(env, itemId);
    return;
  }
  if (!item.source_image_url) {
    await markFailed(env, itemId, "source_image_url is missing");
    return;
  }

  try {
    const limits = getLimits(env);
    const fetched = await safeFetch(item.source_image_url, {
      timeoutMs: limits.fetchTimeoutMs,
      maxBytes: limits.maxBytes,
      allowedMime: limits.allowedMime,
    });

    const sha = await sha256Hex(fetched.body);
    const existing = await env.DB.prepare(`SELECT * FROM assets WHERE sha256 = ?`)
      .bind(sha)
      .first<AssetRow>();

    let asset: AssetRow;
    if (existing) {
      // Dedup hit — no R2 write, no probe; the existing asset is canonical.
      asset = existing;
    } else {
      const dims = probeImage(fetched.body);
      const r2Key = buildR2Key(itemId, fetched.mime);
      await putImage(env, r2Key, fetched.body, fetched.mime);
      await env.DB.prepare(
        `INSERT INTO assets (sha256, mime, byte_size, width, height, r2_key)
         VALUES (?,?,?,?,?,?)`,
      )
        .bind(
          sha,
          fetched.mime,
          fetched.body.byteLength,
          dims?.width ?? null,
          dims?.height ?? null,
          r2Key,
        )
        .run();
      asset = {
        sha256: sha,
        mime: fetched.mime,
        byte_size: fetched.body.byteLength,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        r2_key: r2Key,
      };
    }

    await env.DB.prepare(
      `UPDATE items
          SET r2_key = ?, mime_type = ?, byte_size = ?,
              width = ?, height = ?,
              asset_sha256 = ?, status = 'ready',
              error_message = NULL,
              manifest_json = NULL,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
    )
      .bind(
        asset.r2_key,
        asset.mime,
        asset.byte_size,
        asset.width,
        asset.height,
        asset.sha256,
        itemId,
      )
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(env, itemId, message);
  }
}

async function markReady(env: Env, itemId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE items SET status = 'ready', error_message = NULL,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
  )
    .bind(itemId)
    .run();
}

async function markFailed(env: Env, itemId: string, message: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE items SET status = 'failed', error_message = ?,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
  )
    .bind(message.slice(0, 1024), itemId)
    .run();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer to satisfy `BufferSource` (the workers
  // type narrowing rejects SharedArrayBuffer-backed Uint8Arrays).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
