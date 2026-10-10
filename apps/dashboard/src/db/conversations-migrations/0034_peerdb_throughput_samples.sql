-- PeerDB throughput-zero samples (#3728).
--
-- The previous `rowsSynced` total per CDC mirror, kept between health-sweep
-- ticks so the PeerDB alert cycle can warn when a running mirror stops moving
-- rows (`lib/peerdb/throughput-samples.ts`). `since_ms` is when the total last
-- changed. Fail-open: with no health DB the table never exists and the check
-- is skipped. No owner_id — mirrors come from the one env-configured PeerDB.

CREATE TABLE IF NOT EXISTS peerdb_throughput_samples (
  flow_slug   TEXT    NOT NULL PRIMARY KEY,
  rows_synced INTEGER NOT NULL,
  since_ms    INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
