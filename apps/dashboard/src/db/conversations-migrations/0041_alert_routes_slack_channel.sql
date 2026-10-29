-- Slack bot delivery for webhook routes (#4241): an optional Slack channel id
-- (`C…`, `G…`, `D…`) on a `'webhook'` route. When the route's URL is a Slack
-- incoming webhook and the Slack app is installed in that workspace, alerts
-- post through the bot instead: a compact parent line, details in its thread,
-- and the parent edited on recovery. Not a secret. NULL = webhook only.
ALTER TABLE alert_routes ADD COLUMN slack_channel_id TEXT;
