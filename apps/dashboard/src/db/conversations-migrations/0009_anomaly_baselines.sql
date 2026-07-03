-- Per-host/per-metric statistical anomaly baselines (mean/stddev fitted from
-- MAD/IQR-cleaned samples over a ~7-day window). Replaces static insight
-- thresholds with a per-cluster baseline — see lib/insights/statistical-baseline.ts
-- and plans/48-statistical-anomaly-baselines.md.

CREATE TABLE IF NOT EXISTS anomaly_baselines (
  host_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  mean REAL NOT NULL,
  stddev REAL NOT NULL,
  median REAL,
  mad REAL,
  sample_count INTEGER NOT NULL,
  window_start INTEGER,
  fitted_at INTEGER NOT NULL,
  PRIMARY KEY (host_id, metric)
);
