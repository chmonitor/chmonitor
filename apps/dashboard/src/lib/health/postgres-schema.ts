/**
 * Postgres schema for the twelve health/alert stores (#3493) plus the PeerDB
 * alert rules store (#3699).
 *
 * The D1 schema lives in `db/conversations-migrations/*.sql` (and in a few
 * stores' lazy `MIGRATION_SQL`); this is its Postgres twin, bootstrapped once
 * per client by `PostgresHealthDb` before its first statement. Every statement
 * is idempotent (`IF NOT EXISTS`), so there is no migration runner — the same
 * self-bootstrap pattern as `connection-store/postgres-store.ts`.
 *
 * Differences from the D1 DDL, all deliberate:
 *   - unix-ms columns are BIGINT (Postgres INTEGER is 32-bit and overflows on
 *     `Date.now()`); the adapter parses int8 back to a JS number.
 *   - SQLite REAL becomes DOUBLE PRECISION (Postgres REAL is float4).
 *   - `alert_routes` / `alert_events` carry their later ALTER-added columns
 *     inline instead of replaying the ALTERs.
 *   - 0/1 flags stay INTEGER, because the stores compare them with `=== 1`.
 *   - `custom_alert_rules` is the one exception to "no ALTERs": D1 migration
 *     0032 (#3438) added `check_id` and made metric/op/warning/critical
 *     nullable. A database bootstrapped before that already has the old
 *     table, which `CREATE TABLE IF NOT EXISTS` leaves alone, so the new
 *     shape is inline for fresh databases AND replayed as idempotent
 *     `ADD COLUMN IF NOT EXISTS` / `DROP NOT NULL` / `CREATE UNIQUE INDEX IF
 *     NOT EXISTS` statements for existing ones.
 *
 * Primary keys are unchanged (on-disk formats: `alert_state (host_id, rule_id)`,
 * etc.) — only the dialect differs.
 */

export const HEALTH_POSTGRES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS alert_routes (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL,
  match_rule         TEXT NOT NULL DEFAULT '*',
  match_host         TEXT NOT NULL DEFAULT '*',
  channel_url        TEXT NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         BIGINT NOT NULL,
  provider           TEXT NOT NULL DEFAULT 'webhook',
  service_name       TEXT,
  routing_key        TEXT,
  telegram_bot_token TEXT,
  telegram_chat_id   TEXT,
  ntfy_url           TEXT,
  ntfy_token         TEXT,
  pushover_token     TEXT,
  pushover_user      TEXT,
  min_severity       TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_routes_owner_enabled
  ON alert_routes (owner_id, enabled);

CREATE TABLE IF NOT EXISTS alert_channel_config (
  owner_id     TEXT NOT NULL,
  channel      TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 0,
  min_severity TEXT,
  target_json  TEXT,
  secret       TEXT,
  updated_at   BIGINT NOT NULL,
  PRIMARY KEY (owner_id, channel)
);

CREATE TABLE IF NOT EXISTS alert_state (
  host_id          INTEGER NOT NULL,
  rule_id          TEXT    NOT NULL,
  severity         TEXT    NOT NULL,
  updated_at       BIGINT  NOT NULL,
  notified_at      BIGINT  NOT NULL,
  first_fired_at   BIGINT,
  pending_severity TEXT,
  pending_count    INTEGER,
  PRIMARY KEY (host_id, rule_id)
);

CREATE TABLE IF NOT EXISTS alert_events (
  id            TEXT PRIMARY KEY,
  event_time    TEXT NOT NULL,
  host_id       INTEGER NOT NULL,
  host_label    TEXT,
  rule          TEXT NOT NULL,
  severity      TEXT NOT NULL,
  prev_severity TEXT,
  decision_kind TEXT NOT NULL,
  delivered     INTEGER NOT NULL,
  error         TEXT,
  value         DOUBLE PRECISION,
  channel       TEXT,
  finding_refs  TEXT
);
CREATE INDEX IF NOT EXISTS idx_alert_events_host_time
  ON alert_events (host_id, event_time);

CREATE TABLE IF NOT EXISTS alert_acks (
  owner_id   TEXT    NOT NULL,
  host_id    INTEGER NOT NULL,
  rule_id    TEXT    NOT NULL,
  acked_by   TEXT    NOT NULL DEFAULT '',
  acked_at   BIGINT  NOT NULL,
  expires_at BIGINT  NOT NULL,
  note       TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (owner_id, host_id, rule_id)
);
CREATE INDEX IF NOT EXISTS idx_alert_acks_expiry
  ON alert_acks (owner_id, expires_at);

CREATE TABLE IF NOT EXISTS alert_digest_buffer (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  flush_after BIGINT NOT NULL,
  entry_json  TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_digest_buffer_due
  ON alert_digest_buffer (owner_id, flush_after);

CREATE TABLE IF NOT EXISTS alert_suggestion_dismissals (
  owner_id       TEXT NOT NULL,
  suggestion_key TEXT NOT NULL,
  dismissed_at   BIGINT NOT NULL,
  PRIMARY KEY (owner_id, suggestion_key)
);

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
  updated_at     BIGINT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX IF NOT EXISTS idx_alert_webhook_targets_owner_enabled
  ON alert_webhook_targets (owner_id, enabled);

CREATE TABLE IF NOT EXISTS custom_alert_rules (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  metric     TEXT,
  op         TEXT,
  warning    DOUBLE PRECISION,
  critical   DOUBLE PRECISION,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  check_id   TEXT
);
ALTER TABLE custom_alert_rules ADD COLUMN IF NOT EXISTS check_id TEXT;
ALTER TABLE custom_alert_rules ALTER COLUMN metric DROP NOT NULL;
ALTER TABLE custom_alert_rules ALTER COLUMN op DROP NOT NULL;
ALTER TABLE custom_alert_rules ALTER COLUMN warning DROP NOT NULL;
ALTER TABLE custom_alert_rules ALTER COLUMN critical DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_alert_rules_owner_id
  ON custom_alert_rules (owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_alert_rules_owner_check_id
  ON custom_alert_rules (owner_id, check_id);

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id         TEXT    NOT NULL PRIMARY KEY,
  owner_id   TEXT    NOT NULL,
  host_id    INTEGER,
  reason     TEXT    NOT NULL DEFAULT '',
  starts_at  BIGINT  NOT NULL,
  ends_at    BIGINT  NOT NULL,
  created_by TEXT    NOT NULL DEFAULT '',
  created_at BIGINT  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maint_windows_active
  ON maintenance_windows (owner_id, ends_at);

CREATE TABLE IF NOT EXISTS quiet_hours (
  id           TEXT NOT NULL PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  days         TEXT NOT NULL DEFAULT '[]',
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  timezone     TEXT NOT NULL,
  severity_cap TEXT,
  created_by   TEXT NOT NULL DEFAULT '',
  created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quiet_hours_owner
  ON quiet_hours (owner_id);

CREATE TABLE IF NOT EXISTS peerdb_alert_rules (
  id         TEXT NOT NULL PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  check_type TEXT NOT NULL,
  match_kind TEXT NOT NULL,
  match      TEXT NOT NULL,
  warning    DOUBLE PRECISION NOT NULL,
  critical   DOUBLE PRECISION NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'critical',
  enabled    INTEGER NOT NULL DEFAULT 1,
  mute_until BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_peerdb_alert_rules_owner
  ON peerdb_alert_rules (owner_id);

CREATE TABLE IF NOT EXISTS peerdb_throughput_samples (
  flow_slug   TEXT NOT NULL PRIMARY KEY,
  rows_synced BIGINT NOT NULL,
  since_ms    BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
`
