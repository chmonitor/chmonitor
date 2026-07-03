-- Custom alert rule builder (plan 32): user-defined numeric-threshold rules
-- built from whitelisted metrics (see METRIC_CATALOG in
-- lib/health/rule-builder-schema.ts). `metric` is always a catalog key, never
-- free-form SQL — the SQL itself is never persisted, only re-derived from the
-- catalog at compile time so a future catalog change also updates existing
-- rules. Lives in the shared CHM_CLOUD_D1 database alongside
-- webhook_subscriptions (same owner-scoped feature family).

CREATE TABLE IF NOT EXISTS custom_alert_rules (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  metric TEXT NOT NULL,
  op TEXT NOT NULL,
  warning REAL NOT NULL,
  critical REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_custom_alert_rules_owner_id
  ON custom_alert_rules(owner_id);
