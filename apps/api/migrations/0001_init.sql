-- IIIF Atlas initial schema

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT,
  description TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('reference','cached','iiif_reuse')),

  source_page_url TEXT,
  source_page_title TEXT,
  source_image_url TEXT,
  source_manifest_url TEXT,

  r2_key TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,

  manifest_slug TEXT UNIQUE,
  manifest_json TEXT,

  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_captured_at ON items(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_mode ON items(mode);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection
  ON collection_items(collection_id, position);

CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  resulting_item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_captures_created_at ON captures(created_at DESC);
