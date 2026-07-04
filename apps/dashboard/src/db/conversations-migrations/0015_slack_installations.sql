-- Native Slack app (plans/37-slack-app-native-oauth.md).
-- Lives in the shared CHM_CLOUD_D1 database alongside the other cloud/insights
-- backends (conversations, alert_events, github_deployments). Both tables are
-- optional: with no Slack app configured (the OSS/self-hosted default) they are
-- simply never written to, and the feature stays off.

-- One row per installed Slack workspace. The bot token is stored ENCRYPTED
-- (AES-256-GCM, see lib/slack/token-crypto.ts) — never in the clear.
CREATE TABLE IF NOT EXISTS slack_installations (
  team_id         TEXT PRIMARY KEY,   -- Slack workspace id (T…)
  team_name       TEXT,               -- workspace display name (for the UI)
  bot_token_enc   TEXT NOT NULL,      -- encrypted xoxb- token (base64 envelope)
  bot_user_id     TEXT,               -- the app's bot user id (U…)
  scope           TEXT,               -- granted OAuth scopes (comma list)
  authed_user_id  TEXT,               -- Slack user who performed the install
  -- owner_ref binds the install to a chmonitor owner (Clerk user/org id in
  -- cloud mode) or 'default' for single-tenant OSS installs — mirrors the
  -- owner_scope precedent in github_deployments.
  owner_ref       TEXT NOT NULL DEFAULT 'default',
  installed_at    INTEGER NOT NULL,   -- unix ms
  updated_at      INTEGER NOT NULL    -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_slack_installations_owner
  ON slack_installations (owner_ref);

-- Minimal alert-acknowledgement store. An ACK button on a pushed alert writes
-- one row here keyed by the alert's dedup key (host:rule[:severity]). This is a
-- deliberately minimal, generic ACK primitive — roadmap 29 (alert ACK / manual
-- resolution) owns the fuller state model; when it lands, its store should
-- SUBSUME this table rather than the sweep growing a parallel one. Kept
-- Slack-agnostic (actor + source) so it can be reused, not Slack-only.
CREATE TABLE IF NOT EXISTS alert_acks (
  ack_key       TEXT PRIMARY KEY,   -- alert dedup key, e.g. "0:failed-mutations:critical"
  host_id       INTEGER,
  rule_id       TEXT,
  severity      TEXT,
  acked_by      TEXT NOT NULL,      -- actor id (Slack user id, or a chmonitor user id)
  acked_by_name TEXT,               -- display name, when known
  source        TEXT NOT NULL,      -- where the ACK came from ('slack' | …)
  acked_at      INTEGER NOT NULL    -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_alert_acks_host
  ON alert_acks (host_id, acked_at);
