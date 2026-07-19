-- Per-owner scheduled report subscriptions (#2783 / #2784).
--
-- One row per owner: cadence (off/weekly/monthly), which env hosts the report
-- covers, and a lightweight delivery audit (last attempt time + status).
-- owner_id follows the shared convention: '' for OSS single-tenant, Clerk
-- user id in cloud mode. Delivery goes to the owner's already-configured
-- alert channels (alert_channel_config) — there is no separate recipient list.
--
-- Kept byte-for-byte in sync with the lazy DDL in
-- src/lib/insights/report-subscription-store.ts.
CREATE TABLE IF NOT EXISTS report_subscriptions (
  owner_id TEXT NOT NULL PRIMARY KEY,
  cadence TEXT NOT NULL DEFAULT 'off',
  host_ids TEXT NOT NULL DEFAULT '0',
  last_sent_at INTEGER,
  last_status TEXT,
  updated_at INTEGER NOT NULL
);
