-- v1.0.1 hardening.
--
-- 1. Composite indexes for the soft-delete read path
--    (workspace_id, deleted_at). Every items/collections list now
--    filters on both columns; single-column indexes forced SQLite to
--    scan one side or the other.
-- 2. Composite (workspace_id, captured_at DESC) so the Library list
--    query doesn't sort after a workspace scan.
-- 3. Triggers that enforce the `items.status` enum at the DB level
--    (equivalent to a CHECK constraint — not expressible via ALTER).

CREATE INDEX IF NOT EXISTS idx_items_ws_deleted
  ON items(workspace_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_collections_ws_deleted
  ON collections(workspace_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_items_ws_captured
  ON items(workspace_id, captured_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_items_status_insert
BEFORE INSERT ON items
FOR EACH ROW
WHEN NEW.status NOT IN ('processing','ready','failed')
BEGIN
  SELECT RAISE(ABORT, 'items.status must be processing|ready|failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_items_status_update
BEFORE UPDATE OF status ON items
FOR EACH ROW
WHEN NEW.status NOT IN ('processing','ready','failed')
BEGIN
  SELECT RAISE(ABORT, 'items.status must be processing|ready|failed');
END;
