-- Outbound webhook event bus (plan 44): user-scoped subscriptions + a
-- dead-letter/audit log of every delivery attempt.
-- Lives in the shared CHM_CLOUD_D1 database alongside user_connections
-- (same Clerk-gated, per-user-D1 feature family).

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  -- JSON array of event type strings, e.g. ["connection.created"].
  event_types TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_user_id
  ON webhook_subscriptions(user_id);

-- Dead-letter + audit log: one row per delivery ATTEMPT SEQUENCE (not per
-- HTTP call) — `attempts` records how many HTTP calls that sequence took.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  -- 'delivered' | 'failed' | 'dead'. 'dead' = retries exhausted (or the
  -- destination was rejected outright, e.g. SSRF-blocked / non-retryable 4xx)
  -- and this delivery will not be retried further.
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_status_code INTEGER,
  last_error TEXT,
  event_time INTEGER NOT NULL,
  delivered_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription_time
  ON webhook_deliveries(subscription_id, event_time DESC);
