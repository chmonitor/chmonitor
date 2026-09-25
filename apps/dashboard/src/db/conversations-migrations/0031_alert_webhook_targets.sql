-- Custom alert webhook targets (feat #3414): operator-defined fan-out
-- destinations for health alerts, each with its own output format
-- (auto / raw-json / slack / matrix), severity floor, {{variable}} templates,
-- and X-* custom headers.
--
-- One row per (owner_id, id). owner_id follows the same OSS-single-tenant
-- convention as `alert_channel_config`/`alert_routes`: '' for
-- self-hosted/no-Clerk deployments, the Clerk user id in cloud mode.
--
-- Unlike `alert_channel_config` there is NO `secret` column: the target URL
-- embeds its own credential by convention (same posture as the legacy
-- `webhook` channel), so there is nothing to mask on read.
--
-- Fail-open: with no CHM_CLOUD_D1 binding this table never exists and the
-- store degrades to "no custom targets", so the sweep skips the custom-target
-- fan-out and the legacy global webhook + env behavior is byte-identical.
CREATE TABLE IF NOT EXISTS alert_webhook_targets (
  owner_id       TEXT NOT NULL,
  id             TEXT NOT NULL,
  name           TEXT NOT NULL,
  url            TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 0,
  format         TEXT NOT NULL DEFAULT 'auto',
  min_severity   TEXT,
  title_template TEXT,
  body_template  TEXT,
  headers_json   TEXT,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS idx_alert_webhook_targets_owner_enabled
  ON alert_webhook_targets (owner_id, enabled);
