-- GitHub deployment webhook ingestion (signature-verified) — stores deploy
-- markers for the query-volume timeline overlay so SREs can correlate query
-- spikes / replication lag with releases. See lib/deployments/d1-store.ts and
-- plans/45-github-deploy-correlation.md.
--
-- `id` is GitHub's deployment id (dedupe key for webhook redeliveries).
-- `owner_scope` is a single global scope today ('default') — the column
-- exists for future per-org mapping (see lib/deployments/config.ts).

CREATE TABLE IF NOT EXISTS github_deployments (
  id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL,
  repo TEXT NOT NULL,
  environment TEXT,
  ref TEXT,
  sha TEXT,
  version TEXT,
  created_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_github_deployments_scope_created
  ON github_deployments(owner_scope, created_at);
