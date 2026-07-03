-- Inbound event bus: normalized Alertmanager/Datadog/generic webhook events
-- (see lib/events/normalize.ts, lib/events/event-store.ts, and
-- plans/36-inbound-event-bus-queues.md). dedup_hash is the upsert key: a
-- repeat of the same (source, resource, title, severity) bumps count/last_seen
-- instead of inserting a duplicate row. Retained ~30 days.

CREATE TABLE IF NOT EXISTS event_log (
  dedup_hash  TEXT PRIMARY KEY,
  id          TEXT NOT NULL,
  source      TEXT NOT NULL,
  severity    TEXT NOT NULL,
  resource    TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  labels      TEXT NOT NULL DEFAULT '{}',
  count       INTEGER NOT NULL DEFAULT 1,
  received_at INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_log_last_seen ON event_log(last_seen);
