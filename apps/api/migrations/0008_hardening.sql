-- Sprint 8: production hardening.
--
-- * audit_log: append-only trail for every write we care about.
--   Nothing ever UPDATEs or DELETEs from this table — rotation / retention
--   is handled at the edge (Workers cron, out of scope for the MVP).
-- * items.deleted_at / collections.deleted_at: soft delete. All reads add
--   `deleted_at IS NULL`; /api/trash exposes the tombstones until an
--   admin purge runs.
-- * rate_buckets: token-bucket state keyed by a caller-chosen string.
--   Used by /api/captures to stop a single API key from flooding.

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id)      ON DELETE SET NULL,
  verb          TEXT NOT NULL,                  -- e.g. item.create, share.revoke
  subject_type  TEXT NOT NULL,                  -- item / collection / share / …
  subject_id    TEXT NOT NULL,
  details_json  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_workspace_created
  ON audit_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_subject
  ON audit_log(subject_type, subject_id);

ALTER TABLE items       ADD COLUMN deleted_at TEXT;
ALTER TABLE collections ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_items_deleted_at       ON items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_collections_deleted_at ON collections(deleted_at);

CREATE TABLE IF NOT EXISTS rate_buckets (
  key         TEXT PRIMARY KEY,                 -- e.g. "capture:<api_key_id>"
  tokens      REAL NOT NULL,
  refilled_at TEXT NOT NULL                     -- ISO-8601
);
