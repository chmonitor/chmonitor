-- Persisted alert-dispatch audit log (plans/27-alert-history-audit-log.md).
-- One row per attempted webhook delivery from the health sweep's dedup/notify
-- decision (server-sweep.ts), whether the delivery succeeded or failed.
-- host_id is a shared index into the operator's env-configured hosts
-- (getClickHouseConfigs() reads CLICKHOUSE_* only — never per-user D1
-- connections), so there is no owner_id/tenant column: every caller allowed to
-- read /api/v1/health/* already sees the same host set.
CREATE TABLE IF NOT EXISTS alert_events (
  id             TEXT PRIMARY KEY,       -- crypto.randomUUID()
  event_time     TEXT NOT NULL,          -- ISO-8601 UTC (payload.timestamp or now)
  host_id        INTEGER NOT NULL,
  host_label     TEXT,
  rule           TEXT NOT NULL,          -- metric / rule id
  severity       TEXT NOT NULL,          -- 'warning' | 'critical' | 'recovery'
  prev_severity  TEXT,                   -- prior severity from the decision, if any
  decision_kind  TEXT NOT NULL,          -- decision.kind (e.g. 'new' | 'escalated' | 'reminder' | 'recovery')
  delivered      INTEGER NOT NULL,       -- 1 delivered, 0 attempted-but-failed
  error          TEXT,                   -- delivery error message when delivered = 0
  value          REAL,                   -- observed value (payload.value)
  channel        TEXT                    -- adapter id ('slack'|'telegram'|'discord'|...), when known
);
CREATE INDEX IF NOT EXISTS idx_alert_events_host_time ON alert_events (host_id, event_time);
