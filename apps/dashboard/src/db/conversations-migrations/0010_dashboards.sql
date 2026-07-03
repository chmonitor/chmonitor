-- Per-owner saved dashboards (Chart Builder layouts) with optional read-only
-- sharing. Mirrors the conversations table's ownership model: `id` is the
-- globally-unique internal primary key (never client-supplied — minted
-- server-side), `owner_id` scopes every read/write, and `(owner_id, name)` is
-- unique so a save-by-name upsert can look up the existing row efficiently
-- (preserving the localStorage-era "same name overwrites" behavior).
--
-- `share_slug` is a high-entropy random token (crypto.randomUUID()), never
-- derived from `id`/`name`. The partial unique index guarantees two shared
-- dashboards can never collide on the same slug (NULL slugs — the common,
-- unshared case — are excluded from the uniqueness check).
-- See plans/56-dashboard-d1-persistence-sharing.md.

CREATE TABLE IF NOT EXISTS dashboards (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  is_shared INTEGER NOT NULL DEFAULT 0,
  share_slug TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dashboards_owner_id
  ON dashboards(owner_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_owner_name
  ON dashboards(owner_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_share_slug
  ON dashboards(share_slug)
  WHERE share_slug IS NOT NULL;
