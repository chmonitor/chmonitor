-- Native Matrix alert routes: a route's `provider` may now be `'matrix'`,
-- delivering the finding to a room through the Client-Server API
-- (PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}).
-- `matrix_homeserver_url` is operator-supplied and goes through the same SSRF
-- guard as `ntfy_url`. `matrix_access_token` is a bare secret, stored like
-- `telegram_bot_token` and masked by the routes API. `matrix_room_id` is not a
-- secret and is returned as-is.
ALTER TABLE alert_routes ADD COLUMN matrix_homeserver_url TEXT;
ALTER TABLE alert_routes ADD COLUMN matrix_access_token TEXT;
ALTER TABLE alert_routes ADD COLUMN matrix_room_id TEXT;
