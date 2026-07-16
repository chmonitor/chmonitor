-- Quiet hours (issue #2662): recurring time-of-day alert-delivery silence
-- windows — the recurring sibling of maintenance_windows (0-oneshot). While
-- `now` falls inside a window, server-sweep.ts skips the outbound
-- notification for a finding (the check still runs, the finding is still
-- recorded in alert_events with a `quiet-hours` marker). `days` is a JSON
-- array of weekday numbers (0=Sun..6=Sat), `start_time`/`end_time` are 'HH:mm'
-- wall-clock strings interpreted in `timezone` (IANA), and `severity_cap`
-- (NULL = suppress all, 'critical' = let criticals page) tunes what still
-- gets through. `owner_id` follows the maintenance_windows convention:
-- '' (self-hosted / no Clerk) or the Clerk org/user id in cloud mode. The
-- table is also created lazily by lib/health/quiet-hours.ts, so an OSS
-- deployment that never runs migrations still works.
CREATE TABLE IF NOT EXISTS quiet_hours (
  id           TEXT NOT NULL PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  days         TEXT NOT NULL DEFAULT '[]',
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  timezone     TEXT NOT NULL,
  severity_cap TEXT,
  created_by   TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quiet_hours_owner
  ON quiet_hours (owner_id);
