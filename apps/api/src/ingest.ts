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
 *  1. Load the item (captures workspace_id); bail if missing.
 *  2. safeFetch the source image (SSRF + size + MIME guards still apply).
 *  3. Compute SHA-256 of the bytes.
 *  4. INSERT OR IGNORE into `assets` (PRIMARY KEY sha256) then re-SELECT
 *     the canonical row. Two concurrent ingests of the same bytes
 *     converge on one asset — the second R2.put is wasteful but
 *     idempotent.
 *  5. Update the item (scoped by workspace_id as defense-in-depth).
 *
 * Every status transition writes an audit row so the pipeline is
 * traceable from /api/audit in ops.
 */

import { recordAudit } from "./audit.js";
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
    await markReady(env, item);
    return;
  }
  if (!item.source_image_url) {
    await markFailed(env, item, "source_image_url is missing");
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
    const asset = await upsertAsset(env, sha, fetched, itemId);

    // Scoped by workspace_id as defense-in-depth: even if a forged
    // queue message passed an itemId, we won't touch a row belonging
    // to a different tenant.
    await env.DB.prepare(
      `UPDATE items
          SET r2_key = ?, mime_type = ?, byte_size = ?,
              width = ?, height = ?,
              asset_sha256 = ?, status = 'ready',
              error_message = NULL,
              manifest_json = NULL,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND workspace_id IS ?`,
    )
      .bind(
        asset.r2_key,
        asset.mime,
        asset.byte_size,
        asset.width,
        asset.height,
        asset.sha256,
        itemId,
        item.workspace_id,
      )
      .run();
    await recordAudit(
      env,
      item.workspace_id ? { workspaceId: item.workspace_id, userId: null } : null,
      "item.ingest.ready",
      "item",
      itemId,
      { sha256: sha, bytes: asset.byte_size },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(env, item, message);
  }
}

async function upsertAsset(
  env: Env,
  sha: string,
  fetched: { body: Uint8Array; mime: string },
  itemId: string,
): Promise<AssetRow> {
  const existing = await env.DB.prepare(`SELECT * FROM assets WHERE sha256 = ?`)
    .bind(sha)
    .first<AssetRow>();
  if (existing) return existing;

  const dims = probeImage(fetched.body);
  const r2Key = buildR2Key(itemId, fetched.mime);
  await putImage(env, r2Key, fetched.body, fetched.mime);
  // OR IGNORE lets a parallel ingest of the same bytes land first; we
  // then re-SELECT the canonical row below so both workers converge.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO assets (sha256, mime, byte_size, width, height, r2_key)
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
  const row = await env.DB.prepare(`SELECT * FROM assets WHERE sha256 = ?`)
    .bind(sha)
    .first<AssetRow>();
  if (!row) throw new Error("Asset row vanished after insert");
  return row;
}

async function markReady(env: Env, item: ItemForIngest): Promise<void> {
  await env.DB.prepare(
    `UPDATE items SET status = 'ready', error_message = NULL,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND workspace_id IS ?`,
  )
    .bind(item.id, item.workspace_id)
    .run();
}

async function markFailed(env: Env, item: ItemForIngest, message: string): Promise<void> {
  const trimmed = message.slice(0, 1024);
  await env.DB.prepare(
    `UPDATE items SET status = 'failed', error_message = ?,
                       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND workspace_id IS ?`,
  )
    .bind(trimmed, item.id, item.workspace_id)
    .run();
  await recordAudit(
    env,
    item.workspace_id ? { workspaceId: item.workspace_id, userId: "system" } : null,
    "item.ingest.failed",
    "item",
    item.id,
    { error: trimmed },
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer to satisfy `BufferSource` (the workers
  // type narrowing rejects SharedArrayBuffer-backed Uint8Arrays).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
