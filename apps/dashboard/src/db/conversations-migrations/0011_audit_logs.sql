-- Append-only audit trail for member/billing/connection mutations (enterprise
-- edition only; see lib/audit/logEvent.ts and plans/22-audit-log-export.md).
-- Every row is scoped to org_id, the mandatory export-scoping key — never
-- trust a client-supplied org id when reading this table.
CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,              -- uuid / crypto.randomUUID()
  event_time   TEXT NOT NULL,                 -- ISO-8601 UTC
  org_id       TEXT NOT NULL,                 -- scoping key (Clerk org id)
  user_id      TEXT,                          -- actor Clerk user id (nullable: system/webhook)
  event        TEXT NOT NULL,                 -- e.g. 'member.invited', 'billing.checkout', 'connection.created'
  resource     TEXT,                          -- affected resource id/label
  action       TEXT NOT NULL,                 -- 'create' | 'update' | 'delete' | 'invite' | ...
  result       TEXT NOT NULL,                 -- 'success' | 'denied' | 'error'
  ip           TEXT,                          -- request IP when available
  metadata     TEXT                           -- optional JSON string, small
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_time ON audit_logs (org_id, event_time);
