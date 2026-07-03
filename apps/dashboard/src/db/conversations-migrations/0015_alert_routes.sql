-- Per-rule / per-host alert routing (plan 30): route a notifying finding to
-- one or more channel webhook URLs based on which rule/type and/or host it
-- matched, instead of (or in addition to) the single global
-- HEALTH_ALERT_WEBHOOK_URL. `match_rule` / `match_host` accept `*` (match
-- anything) or a glob pattern; `match_host` matches against either the host id
-- or its display name (see `lib/health/alert-routing.ts`).
--
-- owner_id follows the same OSS-single-tenant convention as
-- `dashboards`/`user_connections`: '' for self-hosted/no-Clerk deployments,
-- the Clerk user id in cloud mode.
CREATE TABLE IF NOT EXISTS alert_routes (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  match_rule   TEXT NOT NULL DEFAULT '*',
  match_host   TEXT NOT NULL DEFAULT '*',
  channel_url  TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_routes_owner_enabled
  ON alert_routes (owner_id, enabled);
