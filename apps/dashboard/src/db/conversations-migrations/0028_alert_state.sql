-- Durable alert state machine (feat #2767).
--
-- Persists the last-known state per (check, host) for the health sweep's
-- transition/hysteresis engine (`lib/health/alert-state-store.ts`). The engine
-- keeps its working set in memory; the sweep hydrates from this table at the
-- start of a tick and flushes back at the end (`alert-state-persist.ts`) so
-- hysteresis streaks and incident timers survive worker restarts.
--
-- Fail-open: with no CHM_CLOUD_D1 binding the table simply never exists and the
-- engine degrades to ephemeral in-memory state (the pre-#2767 behavior). No
-- owner_id column — host_id already scopes every row to the operator's
-- env-configured CLICKHOUSE_* hosts, same as alert_events.
--
-- `pending_severity`/`pending_count` hold an in-flight hysteresis streak
-- awaiting confirmation; `first_fired_at` marks when the current incident began
-- firing so a recovery can report its duration.

CREATE TABLE IF NOT EXISTS alert_state (
  host_id          INTEGER NOT NULL,
  rule_id          TEXT    NOT NULL,
  severity         TEXT    NOT NULL,
  updated_at       INTEGER NOT NULL,
  notified_at      INTEGER NOT NULL,
  first_fired_at   INTEGER,
  pending_severity TEXT,
  pending_count    INTEGER,
  PRIMARY KEY (host_id, rule_id)
);
