-- PagerDuty escalation / on-call routing (plan 34): extend the plan-30
-- `alert_routes` table rather than shipping a second routing schema (open
-- question 1 in the plan). A route now carries a `provider`: `'webhook'`
-- (default, today's Slack/Discord/generic-JSON behavior via `channel_url`) or
-- `'pagerduty'` (routes to a PagerDuty service's Events API v2 integration
-- key via `routing_key`, with `service_name` as the display label). Existing
-- rows default to `provider = 'webhook'` so plan-30 behavior is unchanged.
--
-- `routing_key` is the PagerDuty integration/routing key — a secret, stored
-- at rest the same way channel_url already carries Slack/Discord webhook
-- secrets in its path. Never used to call PagerDuty write/mutation endpoints;
-- only the Events API v2 enqueue endpoint (trigger/resolve).
ALTER TABLE alert_routes ADD COLUMN provider TEXT NOT NULL DEFAULT 'webhook';
ALTER TABLE alert_routes ADD COLUMN service_name TEXT;
ALTER TABLE alert_routes ADD COLUMN routing_key TEXT;
