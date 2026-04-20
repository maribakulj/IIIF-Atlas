-- Sprint 1: auth & multi-workspace tenancy.
--
-- Design:
-- * users + workspaces + workspace_members (RBAC)
-- * api_keys: SHA-256 hashed, scoped to a (user, workspace) pair
-- * items, collections, captures get a workspace_id (nullable in this
--   migration to avoid breaking pre-Sprint-1 data; the API enforces
--   non-null on insert and filters all reads by it).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS workspaces (
  id            TEXT PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,            -- first 12 chars of the raw key, for display
  hashed_key    TEXT UNIQUE NOT NULL,     -- hex SHA-256 of the raw key
  scopes        TEXT,                     -- JSON array; NULL = full access in workspace
  last_used_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user      ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);

ALTER TABLE items       ADD COLUMN workspace_id TEXT;
ALTER TABLE collections ADD COLUMN workspace_id TEXT;
ALTER TABLE captures    ADD COLUMN workspace_id TEXT;

CREATE INDEX IF NOT EXISTS idx_items_workspace       ON items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_collections_workspace ON collections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_captures_workspace    ON captures(workspace_id);
