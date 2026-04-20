-- Sprint 2: ingestion pipeline (assets, dedup, async status).
--
-- assets is the canonical store of cached binary content, addressed by the
-- SHA-256 of its bytes. Items reference assets by sha256, so multiple items
-- (potentially across workspaces) can share a single R2 object — we never
-- re-download or re-store the same bytes.

CREATE TABLE IF NOT EXISTS assets (
  sha256      TEXT PRIMARY KEY,             -- hex, 64 chars
  mime        TEXT NOT NULL,
  byte_size   INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  r2_key      TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- New per-item lifecycle for cached ingestion.
ALTER TABLE items ADD COLUMN asset_sha256  TEXT REFERENCES assets(sha256);
ALTER TABLE items ADD COLUMN status        TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE items ADD COLUMN error_message TEXT;

-- (We don't add a CHECK constraint for status since SQLite ALTER TABLE
-- ADD COLUMN can't carry one; the API enforces the enum.)

CREATE INDEX IF NOT EXISTS idx_items_asset  ON items(asset_sha256);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);

-- Lightweight job log for observability + the retry endpoint. The actual
-- delivery mechanism is Cloudflare Queues; this table records attempts so
-- we have a queryable history independent of the queue's own state.
CREATE TABLE IF NOT EXISTS ingest_jobs (
  id            TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  status        TEXT NOT NULL,            -- queued | running | done | failed
  attempt       INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_item   ON ingest_jobs(item_id);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON ingest_jobs(status);
