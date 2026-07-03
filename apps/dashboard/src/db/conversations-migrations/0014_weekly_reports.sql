-- Persisted per-host weekly health report digests (narrative + baselines +
-- capacity forecast summarized over a rolling 7-day window). See
-- lib/insights/weekly-report-store.ts and
-- plans/52-proactive-weekly-health-report.md.
--
-- The store also creates this table lazily (`CREATE TABLE IF NOT EXISTS`) on
-- first use, mirroring the insights D1 store pattern (store/d1-store.ts) —
-- this migration just gives the deployed CHM_CLOUD_D1 schema an explicit,
-- tracked record. Both are safe together: IF NOT EXISTS is idempotent.
--
-- NOTE: numbered 0014 (not 0010) to leave headroom for other in-flight
-- plans' migrations landing concurrently from sibling worktrees; the highest
-- migration checked into this worktree at the time this was written was 0009.

CREATE TABLE IF NOT EXISTS weekly_reports (
  host_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  html TEXT NOT NULL DEFAULT '',
  delivered INTEGER NOT NULL DEFAULT 0,
  generated_at INTEGER NOT NULL,
  PRIMARY KEY (host_id, week_start)
);
