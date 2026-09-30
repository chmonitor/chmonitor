-- Built-in health check alerts as custom_alert_rules rows (#3438, PR 1/3).
--
-- A check alert is a row with `check_id` set to the built-in check id
-- (`HealthCheckDef.id`, e.g. 'max-parts'). It carries only a display name —
-- no metric, op, or thresholds — so those four columns become nullable. A
-- plain custom rule keeps `check_id` NULL and all four columns set (enforced
-- by the store, not by a CHECK here, so an older worker running between
-- this migration and the new deploy keeps inserting rows unchanged).
--
-- `alert_state` / `alert_acks` stay keyed on (host_id, rule_id) with
-- rule_id = the check id. `check_id` is the stable key; a rename only
-- touches `name`, so it never resets ACKs or alert history.
--
-- One check alert per (owner_id, check_id): the UNIQUE index backs the
-- store's ON CONFLICT(owner_id, check_id) upsert. NULLs are distinct in
-- SQLite, so it never constrains plain custom rules.
--
-- SQLite cannot drop NOT NULL, so the table is rebuilt: create, copy with an
-- explicit column list, drop, rename, recreate indexes. No table references
-- custom_alert_rules, so no foreign key is affected.

CREATE TABLE custom_alert_rules_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  metric TEXT,
  op TEXT,
  warning REAL,
  critical REAL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  check_id TEXT
);

INSERT INTO custom_alert_rules_new
  (id, owner_id, name, metric, op, warning, critical, enabled, created_at, check_id)
SELECT id, owner_id, name, metric, op, warning, critical, enabled, created_at, NULL
FROM custom_alert_rules;

DROP TABLE custom_alert_rules;

ALTER TABLE custom_alert_rules_new RENAME TO custom_alert_rules;

CREATE INDEX IF NOT EXISTS idx_custom_alert_rules_owner_id
  ON custom_alert_rules(owner_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_alert_rules_owner_check_id
  ON custom_alert_rules(owner_id, check_id);
