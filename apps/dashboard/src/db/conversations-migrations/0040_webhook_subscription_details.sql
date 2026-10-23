-- Opt-in structured `alert` block for webhook subscriptions (#3998). Same flag
-- name and meaning as a custom webhook target's `details: true`: 1 adds
-- `data.alert` to alert.fired / alert.resolved deliveries; 0 (default) keeps
-- the body unchanged.
ALTER TABLE webhook_subscriptions ADD COLUMN details INTEGER NOT NULL DEFAULT 0;
