-- Telegram alert channel routing (feat #2655): extend the plan-30
-- `alert_routes` table again rather than shipping a separate schema, exactly
-- as plan 34 did for PagerDuty. A route's `provider` may now also be
-- `'telegram'` — delivering the finding to a Telegram chat via the Bot API
-- `sendMessage` endpoint (`https://api.telegram.org/bot<token>/sendMessage`).
-- Existing rows keep `provider = 'webhook'` so plan-30/34 behavior is
-- unchanged.
--
-- `telegram_bot_token` is the Bot API token — a secret, stored at rest the
-- same way `channel_url` carries Slack/Discord webhook secrets and
-- `routing_key` carries the PagerDuty integration key. It is only ever used to
-- build the outbound sendMessage URL and is masked (never returned in full)
-- by the routes API, like the PagerDuty routing key. `telegram_chat_id` is the
-- target chat id (not a secret).
ALTER TABLE alert_routes ADD COLUMN telegram_bot_token TEXT;
ALTER TABLE alert_routes ADD COLUMN telegram_chat_id TEXT;
