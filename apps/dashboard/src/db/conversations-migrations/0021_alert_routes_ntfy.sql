-- ntfy alert channel routing (feat #2657): extend the plan-30 `alert_routes`
-- table again rather than shipping a separate schema, exactly as plan 34 did
-- for PagerDuty and 0019 did for Telegram. A route's `provider` may now also be
-- `'ntfy'` — delivering the finding to an ntfy topic (self-hostable) by POSTing
-- to `ntfy_url` with Title/Priority/Tags headers + a plain-text body. Existing
-- rows keep `provider = 'webhook'` so plan-30/34 behavior is unchanged.
--
-- `ntfy_url` is the full topic URL (e.g. https://ntfy.sh/my-topic). Unlike the
-- Telegram Bot API's fixed host, this is an OPERATOR-SUPPLIED URL, so the
-- routes API runs it through the same SSRF guard (`validateHostUrl`, HTTPS-only)
-- as a generic webhook `channel_url` before storing it. `ntfy_token` is an
-- optional access token for a protected topic — a secret, stored at rest the
-- same way `telegram_bot_token` / `routing_key` are, and masked (never returned
-- in full) by the routes API.
ALTER TABLE alert_routes ADD COLUMN ntfy_url TEXT;
ALTER TABLE alert_routes ADD COLUMN ntfy_token TEXT;
