CREATE TABLE IF NOT EXISTS hub_entries (
  namespace TEXT NOT NULL CHECK (namespace IN ('links', 'listed', 'pending-publications')),
  id TEXT NOT NULL,
  body_json TEXT NOT NULL,
  preview_jpeg BLOB,
  source_bytes INTEGER NOT NULL CHECK (source_bytes >= 0),
  listing_json TEXT,
  title TEXT,
  created_at TEXT,
  owner_hash TEXT,
  fingerprint TEXT,
  publication_verified INTEGER NOT NULL DEFAULT 0 CHECK (publication_verified IN (0, 1)),
  PRIMARY KEY (namespace, id)
);
CREATE INDEX IF NOT EXISTS hub_publications ON hub_entries (namespace, publication_verified, id);
CREATE INDEX IF NOT EXISTS hub_created ON hub_entries (namespace, created_at, id);
CREATE TABLE IF NOT EXISTS hub_settings (
  key TEXT PRIMARY KEY,
  body_json TEXT NOT NULL,
  source_bytes INTEGER NOT NULL CHECK (source_bytes >= 0)
);
