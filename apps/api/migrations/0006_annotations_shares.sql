-- Sprint 6: annotations + share tokens.
--
-- annotations are IIIF Web Annotations, stored row-per-annotation so we
-- can query by item and render a single AnnotationPage on demand.
-- share_tokens grant pseudonymous read (and, for editor, write) access
-- to one collection or one item; viewers are identified only by their
-- token, so nothing in the workspace leaks.

CREATE TABLE IF NOT EXISTS annotations (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  item_id         TEXT NOT NULL REFERENCES items(id)      ON DELETE CASCADE,
  -- "commenting" is the MVP default; extend by widening the constraint
  -- when we surface the other motivations in the UI.
  motivation      TEXT NOT NULL DEFAULT 'commenting'
                       CHECK (motivation IN ('commenting','tagging','highlighting','describing')),
  target_xywh     TEXT,
  body_value      TEXT,
  body_format     TEXT,
  creator_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_annotations_item      ON annotations(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_annotations_workspace ON annotations(workspace_id);

CREATE TABLE IF NOT EXISTS share_tokens (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash    TEXT UNIQUE NOT NULL,                  -- hex SHA-256 of the raw token
  prefix        TEXT NOT NULL,                         -- first 12 chars of raw, for display
  resource_type TEXT NOT NULL CHECK (resource_type IN ('collection','item')),
  resource_id   TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer'
                     CHECK (role IN ('viewer','editor')),
  created_by    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TEXT,
  revoked_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_share_tokens_resource
  ON share_tokens(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_share_tokens_workspace
  ON share_tokens(workspace_id);
