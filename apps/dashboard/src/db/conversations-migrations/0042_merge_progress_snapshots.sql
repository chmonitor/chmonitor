-- Persistent merge work observations shared by health sweeps.
CREATE TABLE IF NOT EXISTS merge_progress_snapshots (
  host_key TEXT NOT NULL PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL
);
