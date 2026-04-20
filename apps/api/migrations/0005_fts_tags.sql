-- Sprint 5: tags, rights, and full-text search.
--
-- * tags are per-workspace; items pivot through item_tags.
-- * items gain an optional `rights` field (URL to a rights statement
--   or a CC license spdx, intentionally loose — we don't parse it).
-- * items_fts is an FTS5 contentless index of the searchable text
--   fields, kept in sync via triggers. D1 ships with FTS5.

CREATE TABLE IF NOT EXISTS tags (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_tags_workspace ON tags(workspace_id);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);

ALTER TABLE items ADD COLUMN rights TEXT;
CREATE INDEX IF NOT EXISTS idx_items_rights ON items(rights);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  item_id UNINDEXED,
  title,
  description,
  source_page_title,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(item_id, title, description, source_page_title)
  VALUES (new.id, new.title, new.description, new.source_page_title);
END;

CREATE TRIGGER IF NOT EXISTS items_fts_delete AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE item_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS items_fts_update AFTER UPDATE OF title, description, source_page_title ON items BEGIN
  UPDATE items_fts
     SET title = new.title,
         description = new.description,
         source_page_title = new.source_page_title
   WHERE item_id = old.id;
END;
