-- Maintenance windows (alert suppression) — plan 28.
--
-- Lets an operator declare a planned-work window (one host or all hosts) so
-- the health sweep suppresses outbound notifications while `now` falls
-- inside it. The rule still runs and the finding is still reported — this
-- gates dispatch only, not data collection. See lib/health/maintenance-windows.ts.

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id         TEXT    NOT NULL PRIMARY KEY,   -- uuid
  owner_id   TEXT    NOT NULL,               -- billing-owner id (Clerk user_*/org_*); '' for OSS single-tenant
  host_id    INTEGER,                        -- NULL => applies to ALL hosts
  reason     TEXT    NOT NULL DEFAULT '',
  starts_at  INTEGER NOT NULL,               -- unix ms
  ends_at    INTEGER NOT NULL,               -- unix ms
  created_by TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_maint_windows_active
  ON maintenance_windows (owner_id, ends_at);
