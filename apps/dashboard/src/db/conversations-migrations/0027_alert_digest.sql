-- Alert grouping / digest batching (feat #2663).
--
-- Two additive pieces, both fail-open (no CHM_CLOUD_D1 binding ⇒ neither table
-- exists and the in-process, always-on grouping still works; only the optional
-- time-window digest mode degrades to "off"):
--
-- 1. `alert_digest_buffer` — the optional time-window digest queue. When
--    `HEALTH_ALERT_DIGEST_MINUTES` (or the UI-persisted setting) is > 0,
--    NON-critical findings are parked here and flushed by a later sweep tick
--    once their window closes; criticals bypass the buffer entirely. Each row is
--    one groupable delivery entry (a webhook or Telegram send) serialized as
--    JSON, keyed by owner and a `flush_after` epoch-ms deadline. Rows are
--    deleted on flush.
--
-- 2. `alert_events.finding_refs` — a nullable JSON column so ONE digest dispatch
--    is recorded as ONE history row that still references its N findings
--    ("hostId:ruleId" strings). NULL for every normal single-finding event, so
--    existing rows/readers are unaffected.
--
-- owner_id follows the same OSS-single-tenant convention as the other health
-- tables ('' for self-hosted/no-Clerk, the Clerk user id in cloud mode).

CREATE TABLE IF NOT EXISTS alert_digest_buffer (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  flush_after INTEGER NOT NULL,
  entry_json  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_digest_buffer_due
  ON alert_digest_buffer (owner_id, flush_after);

ALTER TABLE alert_events ADD COLUMN finding_refs TEXT;
