-- Per-route severity floor (feat #2661): extend the plan-30 `alert_routes`
-- table again rather than shipping a separate schema, exactly as plan 34 did
-- for PagerDuty, 0019 for Telegram, 0021 for ntfy, and 0024 for Pushover.
--
-- A route may now carry its own `min_severity` ('warning' | 'critical') that
-- beats the channel- and global-level gate for THIS route's finding (see
-- `resolveChannelDelivery` in alert-channel-settings.ts). Existing rows keep
-- `min_severity = NULL`, which inherits the channel/global gate — so plan-30/34
-- routing behavior is unchanged for every row created before this migration.
ALTER TABLE alert_routes ADD COLUMN min_severity TEXT;
