-- Per-owner monthly PEAK over-limit host count (cloud SaaS only, plan 18).
-- One row per (owner_id, month); host_count is the highest billable overage
-- host count observed this month (MAX, not additive) so removing and
-- re-adding a host within the same month doesn't multiply the charge.
-- owner_id mirrors billing-owner ids (Clerk user_* or org_*).
-- month is UTC 'YYYY-MM'.
CREATE TABLE IF NOT EXISTS host_usage_monthly (
  owner_id   TEXT NOT NULL,
  month      TEXT NOT NULL,
  host_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, month)
);
