-- Pushover alert channel routing (feat #2659): extend the plan-30
-- `alert_routes` table again rather than shipping a separate schema, exactly
-- as plan 34 did for PagerDuty, 0019 did for Telegram, and 0021 did for ntfy.
-- A route's `provider` may now also be `'pushover'` — delivering the finding
-- to a Pushover user/group by POSTing to the fixed Messages API endpoint
-- (https://api.pushover.net/1/messages.json) with `pushover_token` +
-- `pushover_user`. Existing rows keep `provider = 'webhook'` so plan-30/34
-- behavior is unchanged.
--
-- Unlike ntfy's operator-supplied topic URL, the Pushover Messages API host is
-- fixed (mirrors the Telegram Bot API) — so `pushover_token`/`pushover_user`
-- are not run through the SSRF guard the way `ntfy_url` is. `pushover_token`
-- is a bare secret (an application API token), stored at rest the same way
-- `telegram_bot_token` / `routing_key` are and masked (never returned in full)
-- by the routes API; `pushover_user` (a user/group key) is not a secret on its
-- own — like `telegram_chat_id`, it identifies the recipient but cannot be
-- used to send messages without a valid app token — so it is returned as-is.
ALTER TABLE alert_routes ADD COLUMN pushover_token TEXT;
ALTER TABLE alert_routes ADD COLUMN pushover_user TEXT;
