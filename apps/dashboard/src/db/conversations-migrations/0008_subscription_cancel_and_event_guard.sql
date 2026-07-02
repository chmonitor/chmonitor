-- Persist cancel-at-period-end state and add a monotonic write guard to
-- user_subscriptions.
--
-- cancel_at_period_end: previously hard-coded to false on the D1 fast path
-- (resolveOwnerSubscription only set it correctly on the Polar-pull path),
-- so a cancelled-but-still-in-grace-period subscription read from cache never
-- showed the "cancels on <date>" state. 0/1 (SQLite has no native boolean).
--
-- event_timestamp: Polar webhook deliveries can arrive out of order (retries,
-- at-least-once delivery). Without an ordering guard, a late/replayed older
-- event can overwrite newer state (e.g. a stale "canceled" landing after a
-- fresher "active" from an uncancel). Unix seconds from the webhook envelope's
-- `timestamp`; NULL for existing rows (treated as "always older" so the next
-- webhook write always wins and backfills it).
ALTER TABLE user_subscriptions ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_subscriptions ADD COLUMN event_timestamp INTEGER;
