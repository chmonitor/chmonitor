-- Unified server-persisted alert channel config (feat #2665): make every
-- delivery channel editable from the UI and visible to the cron sweep, instead
-- of the split brain where client channels (webhook/healthchecks) live in the
-- browser's localStorage and server channels (opsgenie/email/twilio/…) are
-- env-only.
--
-- One row per (owner_id, channel). `enabled` + `min_severity` are the same
-- per-channel gate as #2661 (min_severity NULL = inherit the channel/global
-- gate). `target_json` holds the channel's NON-secret destination fields (urls,
-- chat ids, regions, to/from addresses) as JSON; `secret` holds the channel's
-- ONE secret (api key / bot token / auth token / provider url), write-only and
-- masked on read — never echoed back in full, same posture as a PagerDuty
-- routing key in `alert_routes` (0016).
--
-- owner_id follows the same OSS-single-tenant convention as
-- `alert_routes`/`dashboards`/`user_connections`: '' for self-hosted/no-Clerk
-- deployments, the Clerk user id in cloud mode.
--
-- Fail-open: with no CHM_CLOUD_D1 binding this table never exists and the store
-- degrades to "no rows", so `resolveServerChannels` falls back to the env
-- readers — an env-only deployment is byte-identical to before this migration.
CREATE TABLE IF NOT EXISTS alert_channel_config (
  owner_id     TEXT NOT NULL,
  channel      TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 0,
  min_severity TEXT,
  target_json  TEXT,
  secret       TEXT,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (owner_id, channel)
);
