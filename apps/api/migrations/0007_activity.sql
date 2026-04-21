-- Sprint 7: IIIF Change Discovery feed.
--
-- activity_events is an append-only audit log of public resource
-- mutations (manifests + public collections). We serve it as a paginated
-- IIIF Change Discovery OrderedCollection at /iiif/activity.json so
-- federated consumers (other IIIF sites, aggregators) can discover new
-- content without polling every manifest URL.

CREATE TABLE IF NOT EXISTS activity_events (
  id          TEXT PRIMARY KEY,
  verb        TEXT NOT NULL CHECK (verb IN ('Create','Update','Delete')),
  object_type TEXT NOT NULL CHECK (object_type IN ('Manifest','Collection')),
  object_slug TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_object     ON activity_events(object_type, object_slug);
