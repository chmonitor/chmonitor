-- Bound the unauthenticated POST /v1/event insert (#2503): dedupe repeated
-- identical events within the same UTC day instead of appending unbounded
-- rows, mirroring how ping_daily dedupes on (day, instance_hash).
--
-- /v1/event carries no instance_hash (see
-- apps/dashboard/src/lib/telemetry/event-sink.ts — only `event` + a flat,
-- non-identifying props bag), so the dedup key is the coarser tuple the
-- handler already extracts: (day, event, deploy_target, ch_version,
-- ch_flavor). ch_version is NULL when absent/invalid; SQLite/D1 treat NULL as
-- distinct from NULL in a plain UNIQUE index, so COALESCE it to '' here or
-- two rows that both lack a ch_version would never dedupe against each other.

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe
  ON events (
    day,
    event,
    deploy_target,
    COALESCE(ch_version, ''),
    COALESCE(ch_flavor, '')
  );
