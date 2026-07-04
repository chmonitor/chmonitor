-- Alert ACK / manual resolution (plan 29): an ACK on a (hostId, ruleId)
-- condition suppresses dispatch for a bounded duration, without touching the
-- underlying dedup state in alert-state-store.ts. One active ack per
-- condition; a re-ACK upserts (extends/replaces the expiry + actor).
--
-- 0015_slack_installations.sql previously created a minimal alert_acks stub
-- (ack_key TEXT PRIMARY KEY, no owner_id) that this table subsumes per its own
-- docstring. Drop it first so CREATE TABLE isn't a no-op against the old
-- schema — no code reads the old ack_key/host_id/source columns anymore
-- (the Slack ACK button now calls the ackAlert() API below).
DROP INDEX IF EXISTS idx_alert_acks_host;
DROP TABLE IF EXISTS alert_acks;
CREATE TABLE IF NOT EXISTS alert_acks (
  owner_id    TEXT    NOT NULL,   -- billing-owner id; '' for OSS single-tenant
  host_id     INTEGER NOT NULL,
  rule_id     TEXT    NOT NULL,
  acked_by    TEXT    NOT NULL DEFAULT '',
  acked_at    INTEGER NOT NULL,   -- unix ms
  expires_at  INTEGER NOT NULL,   -- unix ms; suppress while now < expires_at
  note        TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (owner_id, host_id, rule_id)
);
CREATE INDEX IF NOT EXISTS idx_alert_acks_expiry ON alert_acks (owner_id, expires_at);
