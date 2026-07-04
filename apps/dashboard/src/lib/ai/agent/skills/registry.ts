/**
 * Auto-generated skills registry.
 * Run `bun run build:skills` to regenerate from .agents/skills/
 *
 * DO NOT EDIT MANUALLY
 */

import type { Skill } from './types'

export const SKILLS: readonly Skill[] = [
  {
    name: 'replication-guide',
    description:
      'ReplicatedMergeTree operations, failover procedures, lag diagnosis, quorum writes, and Keeper management.',
    content: `# Replication Guide

## ReplicatedMergeTree Basics
- Engine: \`ReplicatedMergeTree('/clickhouse/tables/{shard}/{database}/{table}', '{replica}')\`
- Requires ZooKeeper or ClickHouse Keeper
- All replicas are equal — any replica can accept writes
- Replication is asynchronous by default

## Monitoring Replication
- \`system.replicas\` — per-table status: \`absolute_delay\`, \`queue_size\`, \`is_leader\`, \`is_readonly\`
- \`system.replication_queue\` — pending operations: fetches, merges, mutations
- Key health indicators:
  - \`absolute_delay = 0\` — fully caught up
  - \`is_readonly = 0\` — accepting writes
  - \`queue_size < 10\` — healthy queue
  - \`active_replicas = total_replicas\` — all replicas online

## Failover Procedures
1. Check replica status: \`SELECT * FROM system.replicas WHERE is_readonly = 1\`
2. Verify Keeper connectivity: \`SELECT * FROM system.zookeeper WHERE path = '/'\`
3. If replica is readonly due to Keeper disconnect, it auto-recovers when connection restores
4. For permanent failures: \`SYSTEM DROP REPLICA 'replica_name' FROM TABLE db.table\`
5. Corrupted metadata: \`SYSTEM RESTORE REPLICA db.table\`

## Quorum Writes
- \`SET insert_quorum = 2\` — wait for N replicas to confirm
- \`SET insert_quorum_parallel = 1\` — parallel quorum inserts (v21.8+)
- \`SET insert_quorum_timeout = 60000\` — timeout in ms
- Use for critical data that must survive node failures

## Keeper Management
- ClickHouse Keeper is the recommended replacement for ZooKeeper
- Monitor: \`system.zookeeper\` table for browsing ZK tree
- Key paths: \`/clickhouse/tables/\` for table metadata
- Check Keeper health: \`SELECT * FROM system.asynchronous_metrics WHERE metric LIKE '%Keeper%'\`

## Common Issues
- **Split brain**: Multiple leaders — usually Keeper issue, restart Keeper
- **Readonly replica**: Lost Keeper session — check network, Keeper logs
- **Queue buildup**: Slow fetches — check network bandwidth, disk I/O
- **Diverged replicas**: \`SYSTEM SYNC REPLICA db.table\` to force sync
- Load the \`troubleshooting\` skill for OOM-related replica failures and disk-full scenarios.`,
  },
  {
    name: 'incident-response',
    description:
      'Structured triage recipes for common ClickHouse incidents: disk, errors, replication, mutations, cluster health, and slow queries.',
    content: `# Incident Response

Structured, step-by-step recipes for the most common ClickHouse incidents. Each recipe names the exact tool or system table query, what to look for, and the standard remediation. For multi-step incidents, pair with \`update_plan\` + the **plan-and-verify** skill to track progress and verify each fix before moving to the next step.

---

## 1. Disk Filling Up

**Triggers**: disk usage > 80 %, insert errors mentioning \`DB::Exception: Not enough space\`, alerts on free bytes.

**Step 1 — Check free space per disk**

Use the \`get_disk_usage\` tool or query directly:
\`\`\`sql
SELECT name, path,
       formatReadableSize(free_space) AS free,
       formatReadableSize(total_space) AS total,
       round(100 - free_space * 100.0 / total_space, 1) AS used_pct
FROM system.disks
ORDER BY used_pct DESC
\`\`\`
Alert threshold: \`used_pct > 85\`. Note which disk is filling and which storage policy it belongs to.

**Step 2 — Find the biggest tables and parts**

Use \`get_largest_tables\` tool or:
\`\`\`sql
SELECT database, table,
       formatReadableSize(sum(bytes_on_disk)) AS disk,
       sum(rows) AS rows,
       count() AS parts
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY sum(bytes_on_disk) DESC
LIMIT 20
\`\`\`
Also look at \`system.parts\` with high \`modification_time\` age — old unmerged parts waste space.

**Step 3 — Estimate insert rate and time-to-full**

Use the \`forecast_capacity\` tool. Manual estimate:
\`\`\`sql
SELECT toStartOfHour(event_time) AS hour,
       sum(rows) AS rows_inserted,
       formatReadableSize(sum(bytes_written_to_disk)) AS written
FROM system.part_log
WHERE event_type = 'NewPart'
  AND event_time >= now() - INTERVAL 24 HOUR
GROUP BY hour
ORDER BY hour
\`\`\`
Divide current free bytes by hourly write rate → hours until full.

**Step 4 — Remediation**

- **TTL**: add or tighten \`TTL\` on high-volume tables (\`ALTER TABLE t MODIFY TTL date + INTERVAL 30 DAY\`).
- **Drop partitions**: \`ALTER TABLE t DROP PARTITION '2024-01'\` for old data (irreversible — confirm first).
- **Move to cold tier**: if tiered storage is configured, \`ALTER TABLE t MOVE PARTITION '...' TO DISK 'cold'\`.
- **DETACH + DROP**: for tables no longer needed.
- After any action, re-run step 1 to confirm free space recovered.

Cross-references: **storage-optimization** (TTL syntax, tiered storage), **plan-and-verify** (track multi-partition drops safely).

---

## 2. High Error Rate

**Triggers**: spike in failed queries, user-facing 500s, alert on \`system.errors\`.

**Step 1 — Recent errors from system.errors**

\`\`\`sql
SELECT name, code, value, remote,
       last_error_time, last_error_message
FROM system.errors
WHERE last_error_time >= now() - INTERVAL 1 HOUR
ORDER BY value DESC
LIMIT 20
\`\`\`
\`value\` is the cumulative error count since startup; look for codes with recent \`last_error_time\` and high \`value\`.

**Step 2 — Failed queries with exceptions**

Use \`query_log_errors\` tool or:
\`\`\`sql
SELECT exception_code,
       count() AS cnt,
       topK(5)(exception) AS samples,
       topK(5)(query) AS queries
FROM system.query_log
WHERE type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
  AND event_time >= now() - INTERVAL 1 HOUR
GROUP BY exception_code
ORDER BY cnt DESC
\`\`\`

**Step 3 — Interpret error codes**

| Code | Meaning | Typical fix |
|------|---------|-------------|
| 60 | Table not found | Verify table/database name; check if DROP happened |
| 47 | Unknown column | Use \`get_table_schema\`; column may have been dropped |
| 241 | Memory limit exceeded | Reduce scope; add \`LIMIT\`; raise \`max_memory_usage\` |
| 159 | Timeout | Add time filter; check for table lock (mutations) |
| 252 | Too many parts | Wait for merges; run recipe 4 |
| 285 | Quorum write failed | Check replica availability (recipe 3) |
| 999 | ZooKeeper/Keeper error | Check Keeper health (recipe 3) |

**Step 4 — Check resource pressure**

Use \`get_cluster_health\` or \`get_server_metrics\`:
\`\`\`sql
SELECT metric, value
FROM system.metrics
WHERE metric IN (
  'Query', 'BackgroundMergesAndMutationsPoolTask',
  'ZooKeeperRequest', 'MemoryTracking'
)
\`\`\`
Correlate a memory or Keeper spike with the error burst.

**Step 5 — Remediation**

Fix the specific error code (table, column, limit, Keeper). If a single bad query is causing the spike, kill it:
\`\`\`sql
KILL QUERY WHERE query_id = '...' ASYNC
\`\`\`

Cross-references: **troubleshooting** (error code details, OOM), **anomaly-detection** (automated spike detection).

---

## 3. Replication Lag / Failover

**Triggers**: replica is behind, reads from replica return stale data, \`absolute_delay\` alert.

**Step 1 — Check per-table replication lag**

Use \`check_replication_status\` tool or:
\`\`\`sql
SELECT database, table, replica_name, replica_path,
       is_leader, is_readonly,
       absolute_delay,
       queue_size, inserts_in_queue, merges_in_queue,
       last_queue_update
FROM system.replicas
WHERE absolute_delay > 0 OR queue_size > 0
ORDER BY absolute_delay DESC
\`\`\`
\`absolute_delay > 300\` (5 min) is a concern. \`is_readonly = 1\` means the replica cannot write — usually a Keeper connectivity problem.

**Step 2 — Inspect the replication queue**

\`\`\`sql
SELECT database, table, type, source_replica,
       parts_to_merge, create_time,
       last_attempt_time, last_exception,
       num_tries
FROM system.replication_queue
WHERE last_exception != ''
ORDER BY num_tries DESC
LIMIT 20
\`\`\`
Repeated failures with the same \`last_exception\` point to a stuck task. High \`num_tries\` means the replica has been retrying for a while.

**Step 3 — Keeper health**

\`\`\`sql
SELECT *
FROM system.zookeeper
WHERE path = '/clickhouse'
\`\`\`
Or use the \`check_zookeeper_status\` tool. Look for high \`zookeeper_sessions\` in \`system.metrics\` and watch for \`ZooKeeperRequest\` latency spikes in \`system.asynchronous_metrics\`.

Also check the distributed DDL queue for stuck operations:
\`\`\`sql
SELECT *
FROM system.distributed_ddl_queue
WHERE status != 'Finished'
ORDER BY entry_time
\`\`\`

**Step 4 — Remediation**

- **High lag, queue draining**: wait; lag recovers automatically once the queue drains.
- **is_readonly**: restore Keeper connectivity; then \`SYSTEM RESTART REPLICA db.table\`.
- **Stuck queue task**: \`SYSTEM DROP REPLICA 'bad_host' FROM TABLE db.table\` to remove a dead peer, then let the replica re-sync.
- **Detach + reattach**: last resort — \`DETACH TABLE\`, restore from another replica's data, \`ATTACH TABLE\`.

Cross-references: **replication-guide** (full recovery playbook, detach/reattach steps, Keeper tuning).

---

## 4. Stuck Mutations / Merges

**Triggers**: \`ALTER TABLE ... UPDATE/DELETE\` never completes, \`parts_to_do\` stays non-zero, merge backlog growing.

**Step 1 — Find stuck mutations**

Use \`check_mutations\` tool or:
\`\`\`sql
SELECT database, table, mutation_id,
       command, create_time,
       parts_to_do, is_done,
       latest_fail_reason, latest_fail_time
FROM system.mutations
WHERE is_done = 0
ORDER BY create_time
\`\`\`
\`latest_fail_reason != ''\` tells you exactly why it is stuck (disk space, missing column, Keeper timeout).

**Step 2 — Find long-running merges**

\`\`\`sql
SELECT database, table, elapsed,
       formatReadableSize(total_size_bytes_compressed) AS size,
       progress, merge_type,
       partition_id
FROM system.merges
ORDER BY elapsed DESC
LIMIT 10
\`\`\`
\`elapsed > 3600\` (1 hour) for a merge is unusual. \`progress\` not advancing over several minutes means the merge is likely stuck.

**Step 3 — Check the part count**

\`\`\`sql
SELECT database, table, partition_id,
       count() AS parts
FROM system.parts
WHERE active
GROUP BY database, table, partition_id
HAVING parts > 100
ORDER BY parts DESC
\`\`\`
Excessive parts (>300 in a partition) cause mutations and merges to slow or hang.

**Step 4 — Remediation**

- **Kill a stuck mutation**: \`KILL MUTATION WHERE mutation_id = 'mutation_8.txt'\`
- **Kill a stuck merge**: mutations and merges cannot be killed directly; reduce \`background_pool_size\` load by pausing inserts temporarily.
- **Fix the root cause**: if \`latest_fail_reason\` mentions disk space, run recipe 1 first.
- **Too many parts**: throttle inserts; increase \`max_bytes_to_merge_at_max_space_in_pool\` or temporarily \`OPTIMIZE TABLE t PARTITION 'part'\` during off-peak.
- **Prefer non-mutating patterns**: use \`ReplacingMergeTree\` + \`CollapsingMergeTree\` over heavy UPDATE/DELETE mutations.

Cross-references: **troubleshooting** (mutation + merge details), **storage-optimization** (part count management).

---

## 5. Cluster Health Sweep

**Triggers**: routine check-in, "how is the cluster", pre-maintenance review, post-deploy verification.

Run these in order. Each surfaces a different failure class.

**Step 1 — Server uptime and version**

Use \`get_server_info\` tool:
\`\`\`sql
SELECT version(), uptime(), now()
\`\`\`
Unexpected recent uptime means a crash restart occurred.

**Step 2 — Disk headroom**

Run step 1 of recipe 1. Flag any disk above 80 %.

**Step 3 — Recent slow queries**

\`\`\`sql
SELECT query_id,
       round(query_duration_ms / 1000, 1) AS secs,
       read_rows, formatReadableSize(read_bytes) AS read,
       memory_usage, query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 15 MINUTE
  AND query_duration_ms > 5000
ORDER BY query_duration_ms DESC
LIMIT 10
\`\`\`

**Step 4 — Recent errors**

Use \`get_error_summary\` tool or run step 1 of recipe 2.

**Step 5 — Merge backlog**

\`\`\`sql
SELECT count() AS active_merges,
       sum(elapsed) AS total_elapsed_s,
       max(elapsed) AS longest_s
FROM system.merges
\`\`\`
\`active_merges > 50\` or \`longest_s > 600\` warrants investigation (recipe 4).

**Step 6 — Replication status**

\`\`\`sql
SELECT count() AS lagging_tables,
       max(absolute_delay) AS max_delay_s,
       sum(queue_size) AS total_queue
FROM system.replicas
WHERE absolute_delay > 30 OR queue_size > 10
\`\`\`
Any \`lagging_tables > 0\` with growing \`max_delay_s\` → recipe 3.

**Step 7 — Summarize**

Report findings in priority order: disk → replication → merges → errors → slow queries. Use \`update_plan\` to record findings and track follow-up actions.

Cross-references: **anomaly-detection** (automated sweep), **plan-and-verify** (track remediation steps).

---

## 6. Slow Query Investigation

**Triggers**: a specific query is slow, user reports latency, \`query_duration_ms\` alert.

**Step 1 — Currently running queries**

Use \`get_running_queries\` tool or:
\`\`\`sql
SELECT query_id, user, elapsed,
       read_rows, formatReadableSize(read_bytes) AS read,
       memory_usage,
       query
FROM system.processes
ORDER BY elapsed DESC
\`\`\`
A query running for minutes is usually either doing a full scan or waiting for a merge/mutation to release a lock.

**Step 2 — Historical slow queries**

\`\`\`sql
SELECT query_id,
       event_time,
       round(query_duration_ms / 1000, 1) AS secs,
       read_rows,
       formatReadableSize(read_bytes) AS read,
       ProfileEvents['SelectedMarks'] AS marks_selected,
       ProfileEvents['MergeTreeDataSelectExecutorReadRows'] AS rows_from_disk,
       exception,
       query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 1 HOUR
  AND query_duration_ms > 3000
ORDER BY query_duration_ms DESC
LIMIT 20
\`\`\`
\`marks_selected\` high relative to actual result rows → full granule scan, missing primary key filtering.

**Step 3 — Explain the query plan**

Use the \`explain_query\` tool. Look for:
- \`ReadFromMergeTree\` with no key condition → full table scan
- \`Filter\` after \`ReadFromMergeTree\` instead of before → PREWHERE opportunity
- \`PartialSortingTransform\` with huge row counts → missing ORDER BY key alignment
- Large \`HashJoin\` build side → consider \`join_algorithm = 'partial_merge'\`

**Step 4 — Check table schema and sorting key**

Use \`get_table_schema\` tool. Verify:
- The WHERE columns are in the primary key (in order).
- The time column is first or second in the key for time-range queries.
- Partition by granularity matches query patterns.

**Step 5 — Remediation**

- Add \`PREWHERE\` for selective low-cardinality filters applied before reading full columns.
- Add a skipping index (\`INDEX idx col TYPE bloom_filter\`) for high-cardinality equality lookups.
- Rewrite JOIN to use a smaller build side; filter before joining.
- For aggregate-only queries, consider a materialized view that pre-aggregates.
- Kill the query if it is consuming excessive resources and a fix is ready: \`KILL QUERY WHERE query_id = '...' ASYNC\`.

Cross-references: **query-tuning-advisor** (index selection, MV design), **plan-and-verify** (test the rewrite safely before production).

---

## General Guidance

- Always **scope the time window first** — narrow \`event_time\` filters prevent query_log scans from timing out.
- Use \`update_plan\` to record what you found, what you changed, and what to verify — especially for multi-step incidents.
- After any remediation, **re-run the diagnostic query** from that recipe step to confirm the metric improved.
- For incidents that span multiple categories (e.g., replication lag caused by disk full), resolve in dependency order: disk → Keeper → replication.
- Load the **anomaly-detection** skill to set up proactive alerting so the same incident does not recur silently.`,
  },
  {
    name: 'anomaly-detection',
    description:
      'Detect cluster abnormalities by comparing recent activity (last 1h) to a baseline (preceding 24h) using the raw query tool.',
    content: `# Anomaly Detection

Use this skill when no dedicated tool covers anomaly detection. All recipes below
use the \`query\` tool with raw SQL. Compare a **recent window** (last 1 hour) to a
**baseline window** (preceding 24 hours) and surface ratios or deltas that exceed
the thresholds in the interpretation section.

Column availability varies by ClickHouse version — load \`system-tables-reference\`
before modifying any query.

---

## Error-Rate Spike

**Source**: \`system.query_log\` (per-query granularity) + \`system.errors\` (server-wide counters).

\`\`\`sql
-- Ratio of failed queries: recent vs baseline
-- recent  = last 1 hour, baseline = prior 24 hours
SELECT
    countIf(type = 'ExceptionWhileProcessing' AND event_time >= now() - INTERVAL 1 HOUR)  AS recent_failures,
    countIf(type != 'QueryStart'              AND event_time >= now() - INTERVAL 1 HOUR)  AS recent_total,
    countIf(type = 'ExceptionWhileProcessing' AND event_time  < now() - INTERVAL 1 HOUR
                                              AND event_time >= now() - INTERVAL 25 HOUR) AS baseline_failures,
    countIf(type != 'QueryStart'              AND event_time  < now() - INTERVAL 1 HOUR
                                              AND event_time >= now() - INTERVAL 25 HOUR) AS baseline_total,
    round(recent_failures  / nullIf(recent_total,   0) * 100, 2) AS recent_error_pct,
    round(baseline_failures / nullIf(baseline_total, 0) * 100, 2) AS baseline_error_pct
FROM system.query_log
WHERE is_initial_query = 1
\`\`\`

\`\`\`sql
-- Top error codes in the recent window
SELECT exception_code, count() AS n, any(exception) AS sample
FROM system.query_log
WHERE type = 'ExceptionWhileProcessing'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 1 HOUR
GROUP BY exception_code
ORDER BY n DESC
LIMIT 20
\`\`\`

\`\`\`sql
-- system.errors: codes whose value jumped since last hour
-- (no time column — compare last_error_time as a proxy)
SELECT name, code, value, last_error_time, last_error_message
FROM system.errors
WHERE last_error_time >= now() - INTERVAL 1 HOUR
ORDER BY value DESC
LIMIT 20
\`\`\`

---

## Query Duration Regression

**Source**: \`system.query_log\`.

\`\`\`sql
-- p95 duration: recent 1h vs baseline 24h
SELECT
    quantileIf(0.95)(query_duration_ms,
        event_time >= now() - INTERVAL 1 HOUR)  AS p95_recent_ms,
    quantileIf(0.95)(query_duration_ms,
        event_time  < now() - INTERVAL 1 HOUR
        AND event_time >= now() - INTERVAL 25 HOUR) AS p95_baseline_ms,
    round(p95_recent_ms / nullIf(p95_baseline_ms, 0), 2) AS ratio
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 25 HOUR
\`\`\`

\`\`\`sql
-- Break down by user to find who regressed
SELECT
    user,
    quantileIf(0.95)(query_duration_ms,
        event_time >= now() - INTERVAL 1 HOUR)  AS p95_recent_ms,
    quantileIf(0.95)(query_duration_ms,
        event_time  < now() - INTERVAL 1 HOUR
        AND event_time >= now() - INTERVAL 25 HOUR) AS p95_baseline_ms,
    round(p95_recent_ms / nullIf(p95_baseline_ms, 0), 2) AS ratio
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 25 HOUR
GROUP BY user
ORDER BY ratio DESC
LIMIT 20
\`\`\`

---

## Query Volume Spike / Drop

**Source**: \`system.query_log\`.

\`\`\`sql
-- Queries per minute: recent 1h vs baseline hourly average
SELECT
    countIf(event_time >= now() - INTERVAL 1 HOUR) AS recent_count,
    countIf(event_time  < now() - INTERVAL 1 HOUR
        AND event_time >= now() - INTERVAL 25 HOUR) / 24 AS baseline_hourly_avg,
    round(recent_count / nullIf(baseline_hourly_avg, 0), 2) AS ratio
FROM system.query_log
WHERE type != 'QueryStart'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 25 HOUR
\`\`\`

\`\`\`sql
-- Per-minute breakdown of the last 2 hours (spot sudden spikes or drops)
SELECT
    toStartOfMinute(event_time) AS minute,
    count() AS queries
FROM system.query_log
WHERE type != 'QueryStart'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 2 HOUR
GROUP BY minute
ORDER BY minute
\`\`\`

---

## Memory Anomalies

**Source**: \`system.query_log\` (\`memory_usage\` is per-query peak).

\`\`\`sql
-- Peak memory_usage: recent p95 vs baseline p95
SELECT
    quantileIf(0.95)(memory_usage,
        event_time >= now() - INTERVAL 1 HOUR)  AS p95_recent_bytes,
    quantileIf(0.95)(memory_usage,
        event_time  < now() - INTERVAL 1 HOUR
        AND event_time >= now() - INTERVAL 25 HOUR) AS p95_baseline_bytes,
    formatReadableSize(p95_recent_bytes)   AS p95_recent,
    formatReadableSize(p95_baseline_bytes) AS p95_baseline,
    round(p95_recent_bytes / nullIf(p95_baseline_bytes, 0), 2) AS ratio
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 25 HOUR
\`\`\`

\`\`\`sql
-- Top memory consumers in the last hour
SELECT
    user, substring(query, 1, 200) AS query_preview,
    formatReadableSize(memory_usage) AS mem,
    query_duration_ms
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 1 HOUR
ORDER BY memory_usage DESC
LIMIT 10
\`\`\`

\`\`\`sql
-- Current server-wide memory tracking (instantaneous)
SELECT metric, value, description
FROM system.metrics
WHERE metric IN ('MemoryTracking', 'MemoryAllocated')
\`\`\`

---

## Part-Count Explosion

**Source**: \`system.parts\`. High active-part counts per table indicate merge
backpressure or excessive insert batching.

\`\`\`sql
-- Tables with the most active parts right now
SELECT
    database,
    table,
    count() AS active_parts,
    sum(rows) AS total_rows,
    formatReadableSize(sum(bytes_on_disk)) AS disk_size
FROM system.parts
WHERE active = 1
GROUP BY database, table
ORDER BY active_parts DESC
LIMIT 30
\`\`\`

\`\`\`sql
-- Flag tables that exceeded a threshold in the last day
-- (join today vs yesterday snapshot via modification_time proxy)
SELECT
    database,
    table,
    countIf(modification_time >= now() - INTERVAL 1 HOUR)  AS parts_added_1h,
    countIf(modification_time >= now() - INTERVAL 25 HOUR) AS parts_total_25h,
    count() AS active_parts
FROM system.parts
WHERE active = 1
GROUP BY database, table
HAVING active_parts > 300 OR parts_added_1h > 50
ORDER BY active_parts DESC
LIMIT 20
\`\`\`

Use the \`get_merge_status\` tool to check if background merges are keeping up. See
\`troubleshooting\` for error code 252 (too many parts).

---

## Replication Lag

**Source**: \`system.replicas\`. \`absolute_delay\` is seconds behind the leader.

\`\`\`sql
-- Tables with non-zero replication lag
SELECT
    database,
    table,
    is_leader,
    is_readonly,
    absolute_delay,
    queue_size,
    inserts_in_queue,
    merges_in_queue,
    active_replicas,
    total_replicas
FROM system.replicas
WHERE absolute_delay > 0 OR is_readonly = 1 OR active_replicas < total_replicas
ORDER BY absolute_delay DESC
\`\`\`

\`\`\`sql
-- Trend: max absolute_delay across all replicated tables
SELECT
    database,
    table,
    absolute_delay,
    formatReadableTimeDelta(absolute_delay) AS lag_human
FROM system.replicas
ORDER BY absolute_delay DESC
LIMIT 10
\`\`\`

For diagnosis and recovery steps, load the \`replication-guide\` skill.

---

## How to Interpret Results

| Signal | Threshold (guide, not absolute) | Action |
|--------|----------------------------------|--------|
| Error-rate ratio \`recent_error_pct / baseline_error_pct\` | > 2× | Investigate top error codes; load \`troubleshooting\` |
| p95 duration ratio | > 1.5× | Check new/changed queries, index usage; load \`query-optimization\` |
| Query volume ratio | < 0.3× or > 3× | Verify application health; check for batch jobs or traffic anomaly |
| Memory p95 ratio | > 2× | Find heavy queries; consider \`max_memory_usage\`; load \`troubleshooting\` |
| \`active_parts\` per table | > 300 (MergeTree default warn zone) | Check merge queue via \`get_merge_status\`; consider OPTIMIZE |
| \`absolute_delay\` | > 300 s (5 min) | Replication is lagging; load \`replication-guide\` |

**Noise vs real anomaly**: a ratio spike in a 1-hour window with fewer than ~50
total events is likely noise (small sample). Check the raw counts (\`recent_total\`,
\`baseline_total\`) before escalating. A sustained anomaly across two consecutive
1-hour windows is more actionable.

**Baseline window caveat**: the 24-hour baseline includes the recent 1 hour in
some queries above for simplicity. If you want a strictly prior baseline, replace
\`INTERVAL 25 HOUR\` with \`INTERVAL 24 HOUR\` and add \`AND event_time < now() -
INTERVAL 1 HOUR\` to the baseline predicate.

---

## Cross-references

- \`system-tables-reference\` — exact column names before modifying any SQL above
- \`troubleshooting\` — error codes, OOM, stuck mutations
- \`replication-guide\` — replication lag diagnosis and recovery
- \`query-optimization\` — EXPLAIN, PREWHERE, JOIN tuning for duration regressions
- \`storage-optimization\` — disk pressure if part-count explosion fills the disk`,
  },
  {
    name: 'plan-and-verify',
    description:
      'Decompose multi-step tasks into an explicit update_plan checklist, then verify each result before stating it as fact.',
    content: `# Plan-and-Verify

Use this discipline for any task that spans 3 or more distinct actions. The goal is to avoid the two most common agent mistakes: stating a finding before it is confirmed, and losing track of what has actually been done.

## When to Plan

Use \`update_plan\` when the work genuinely has multiple phases:

- **Investigations**: 3+ queries or tool calls needed to reach a conclusion
- **Changes / recommendations**: any action where a wrong answer has real cost (e.g., index advice, setting change, schema alter)
- **Anomaly diagnosis**: root cause requires cross-checking multiple signals
- **Multi-table analysis**: correlating data across system tables or time windows

Skip it for single-shot answers — if one \`query\` call settles the question, call it and respond directly. \`update_plan\` exists to make complex work transparent, not to add ceremony to simple requests.

## Using the \`update_plan\` Tool

**Call once up front** to lay out the full plan. Set the first step to \`in_progress\` and every other step to \`pending\` (omitting \`status\` defaults to \`pending\`):

\`\`\`
update_plan(steps=[
  { title: "Scan query_log for slow queries (last 24 h)", status: "in_progress" },
  { title: "Check merge backlog on affected tables" },
  { title: "Verify finding against a narrower time window" },
  { title: "Summarize confirmed findings" },
])
\`\`\`

**Call again after each step completes** to advance the checklist. Mark the finished step \`completed\`, the next one \`in_progress\`, and leave the rest \`pending\`:

\`\`\`
update_plan(steps=[
  { title: "Scan query_log for slow queries (last 24 h)", status: "completed" },
  { title: "Check merge backlog on affected tables",       status: "in_progress" },
  { title: "Verify finding against a narrower window" },
  { title: "Summarize confirmed findings" },
])
\`\`\`

**Rules:**
- Exactly one step is \`in_progress\` at any moment.
- Keep plans to ≤ 7 steps. If something needs more, it is two separate tasks.
- Titles are action-oriented and short (≤ 140 chars): "Scan query_log …", "Run EXPLAIN on both versions", "Cross-check baseline".
- Add a \`note\` field when the current status needs a one-line callout: \`note: "High merge backlog confirmed — checking root cause"\`.

## The VERIFY Discipline

Produce a result. Then confirm it before reporting it. "Looked right" is not verification.

### Data findings — re-run a tighter query

A wide-window query identifies a candidate. Before calling it a finding, re-run against a narrower window or a second system table to confirm the signal is real and not an artifact of the aggregation window.

\`\`\`sql
-- Initial: top tables by read_bytes, last 7 days
SELECT tables[1] AS tbl, avg(read_bytes) FROM system.query_log
WHERE event_date >= today() - 7 AND type = 'QueryFinish'
GROUP BY tbl ORDER BY avg(read_bytes) DESC LIMIT 10

-- Verify: same table, last 1 day — does the pattern hold?
SELECT tables[1] AS tbl, count(), avg(read_bytes)
FROM system.query_log
WHERE event_date = today() AND type = 'QueryFinish' AND tables[1] = '<candidate>'
GROUP BY tbl
\`\`\`

If the narrower window contradicts the wide one, report the discrepancy — do not average the two.

### Query rewrites — compare with EXPLAIN

Never claim a rewrite is "faster" without evidence. Use \`explain_query\` on both the original and the rewrite. Compare \`rows_read\` estimates. Report the ratio, not just "better".

\`\`\`
explain_query(query="SELECT ... -- original")
explain_query(query="SELECT ... -- rewrite")
\`\`\`

If \`rows_read\` is identical, the rewrite does not improve scan cost — say so even if the SQL looks cleaner.

### Settings / schema recommendations — state the measurement

A recommendation without a measurable effect is a hypothesis. Every recommendation must include:
1. The expected effect (e.g., "reduces part count in this partition from ~800 to ~200 over one merge cycle")
2. How the user can measure it: the exact query or metric to check before and after

Example: recommending a lower \`merge_max_block_size\`:
> Expected: smaller memory peaks per merge. Measure: \`SELECT max(memory_usage) FROM system.merges\` before and ~30 min after applying the setting.

### Anomaly claims — confirm baseline and signal-to-noise

Before flagging a metric as anomalous:
1. Establish the baseline window (e.g., same hour yesterday, or last 7-day average).
2. Confirm the current value exceeds the baseline by a meaningful margin (not just rounding noise).
3. Check whether the anomaly is isolated to one host or cluster-wide.

\`\`\`sql
-- Baseline: avg query duration same hour yesterday
SELECT avg(query_duration_ms) FROM system.query_log
WHERE type = 'QueryFinish' AND event_time BETWEEN yesterday() + INTERVAL 14 HOUR AND yesterday() + INTERVAL 15 HOUR

-- Current: same hour today
SELECT avg(query_duration_ms) FROM system.query_log
WHERE type = 'QueryFinish' AND event_time >= now() - INTERVAL 1 HOUR
\`\`\`

If the current value is 1.05× the baseline, it is noise. If it is 4×, it is a finding.

## Reporting: Verified vs. Hypotheses

Always separate what you confirmed from what you inferred.

**Structure your final response as:**

- **Confirmed** — findings backed by at least two data points or a re-run verification query
- **Likely** — single data point, plausible but not cross-checked
- **Hypothesis** — pattern that warrants investigation but was not verified in this session

Never present a hypothesis as a confirmed finding. Surface uncertainty explicitly: "This looks like a merge backlog issue, but I was not able to verify the part count trend — check \`system.part_log\` to confirm."

## Worked Example: 4-Step Investigation

**Request**: "Why are queries on \`events\` slow since yesterday afternoon?"

**Step 1 — Plan**
\`\`\`
update_plan(steps=[
  { title: "Scan query_log for slow queries on events (last 48 h)", status: "in_progress" },
  { title: "Check part count and merge backlog on events" },
  { title: "Verify: narrow window + cross-check parts growth" },
  { title: "Report confirmed findings with measurement guidance" },
])
\`\`\`

**Step 2 — Scan query_log**  
Query returns: \`avg(query_duration_ms)\` jumped from 420 ms to 3 100 ms starting at 14:00 yesterday. First guess: memory pressure.

**Step 3 — Check merge backlog**  
\`get_merge_status\` shows 0 active merges. \`system.parts WHERE table = 'events' AND active = 1\` returns 1 840 parts — unusually high. This contradicts the memory-pressure guess.

**Step 4 — Verify**  
Re-run with \`event_time >= yesterday() + INTERVAL 13 HOUR\` (one hour before the slowdown). Parts were 340 at 13:00, grew to 1 840 by 15:00. The part explosion matches a batch insert job. Memory pressure ruled out.

\`\`\`
update_plan(steps=[
  { title: "Scan query_log for slow queries on events (last 48 h)", status: "completed" },
  { title: "Check part count and merge backlog on events",           status: "completed" },
  { title: "Verify: narrow window + cross-check parts growth",       status: "completed" },
  { title: "Report confirmed findings with measurement guidance",    status: "in_progress" },
])
\`\`\`

**Report:**
- **Confirmed**: Part count on \`events\` grew from ~340 to ~1 840 between 13:00 and 15:00 yesterday, correlating directly with the query slowdown (4× duration increase). Caused by a high-frequency insert job creating many small parts.
- **Recommendation**: Merge parts with \`OPTIMIZE TABLE events PARTITION <partition> FINAL\` (off-peak). Then reduce insert frequency or batch larger inserts. Measure: \`SELECT count() FROM system.parts WHERE table = 'events' AND active = 1\` — should drop below 400 after merge completes.
- **Hypothesis** (not verified): the insert job may be running on a fixed schedule — check \`system.query_log WHERE query LIKE '%INSERT INTO events%'\` grouped by hour to confirm recurrence.

## Cross-references

- \`anomaly-detection\` — baseline calculation patterns and signal thresholds
- \`query-tuning-advisor\` — EXPLAIN interpretation and rewrite patterns
- \`troubleshooting\` — error-code diagnosis workflows that pair well with this loop`,
  },
  {
    name: 'query-optimization',
    description:
      'Advanced query tuning: join algorithms, skip index selection, EXPLAIN interpretation, ProfileEvents profiling, and optimizer settings. Also the autonomous diagnose-loop for open-ended questions like why is my database slow?',
    content: `# Query Optimization

## Autonomous Diagnose Loop ("why is my database slow?")

Use this loop when the question is open-ended — no specific query was named —
and the agent must find what's slow on its own, not just tune a query the user
already pasted (for that, load \`query-tuning-advisor\` instead).

**Recommend-only, same as \`advisor-tools\` and \`control-tools\`: this loop never
executes DDL, never rewrites a query in place, and never runs an optimize/kill
action on its own. Every step below only reads system tables; the final output
is DDL/rewrite text for the user to review and run themselves.**

1. **List slow patterns** — call \`list_slow_query_patterns\` (not
   \`get_slow_queries\`, which returns individual runs, not grouped patterns).
   Defaults to the last 24h, ranked by total duration. Identify the top 1-3
   patterns by \`total_duration\` (overall cost) and separately note any pattern
   with a high \`p99_duration\` relative to \`p50_duration\` (tail-latency outlier)
   or a nonzero \`errors\` count.
2. **EXPLAIN the worst pattern** — take \`normalized_query\` from step 1 and call
   \`explain_query\` with \`type: 'indexes'\` first (are granules being pruned?),
   then \`type: 'plan'\` if the indexes output doesn't explain the cost (e.g. a
   large JOIN build side or heavy aggregation step). See "EXPLAIN Analysis"
   below for what to look for.
3. **Get ranked recommendations** — call \`get_optimization_recommendations\`
   with the same query (\`sql\` or a \`queryId\` from \`system.query_log\`) to get
   ranked skip-index / projection / partition-key / PREWHERE suggestions with
   DDL text, rationale, risk, and effort.
4. **Propose, don't apply** — present the top 1-2 recommendations with their
   DDL/rewrite text, expected impact, and risk. If a pattern also looks like a
   good materialized-view/projection candidate (same GROUP BY shape recurring
   often — see \`calls\` in step 1), also call \`recommend_materialized_view\` and
   present that as an alternative. Explicitly tell the user these are
   recommendations to review and run themselves — mirror the control-tools
   confirmation posture, just for read-only advice instead of a destructive
   action.
5. Repeat for the next pattern only if the user wants more than one addressed,
   or if step 1 flagged both a total-duration offender and a separate
   tail-latency/error offender.

## JOIN Strategies
- \`join_algorithm\` setting: \`hash\` (default, in-memory), \`partial_merge\` (spills to disk for large right table), \`auto\` (lets ClickHouse decide)
- \`JOIN ... USING\` avoids repeated column names vs \`ON\` for same-name columns
- Filter both sides before joining to reduce intermediate data
- \`GLOBAL JOIN\` broadcasts the right table to all shards for distributed queries

## EXPLAIN Analysis
- \`EXPLAIN PLAN\` — logical plan, shows projection/pushdown transformations
- \`EXPLAIN PIPELINE\` — physical execution with parallelism info and port counts
- \`EXPLAIN INDEXES\` — which indexes fire, granules selected vs total
- Look for: full table scans, missing index usage, excessive granule reads

## Index Usage
- Skip index types with use-cases:
  - \`minmax\` — range queries on numeric/date columns
  - \`set(N)\` — equality on low-cardinality columns, stores N unique values per granule
  - \`bloom_filter\` — equality on high-cardinality strings
  - \`tokenbf_v1\` — tokenized text search (logs, URLs)
- Check effectiveness via \`ProfileEvents['SelectedRows']\` vs result size

## Query Profiling
- \`ProfileEvents\` map counters: \`SelectedRows\`, \`MergedRows\`, \`FileOpen\`, \`SeekCount\`
- \`normalized_query_hash\` to group parameterized query variants
- \`system.query_log\` columns: \`query_duration_ms\`, \`memory_usage\`, \`read_bytes\`

## Optimizer Settings
- \`enable_optimizer = 1\` — activates ClickHouse's new cost-based query optimizer (v22.6+)
- \`max_threads\` — controls query parallelism; higher = faster but more memory; lower for concurrent workloads
- \`prefer_localhost_replica = 1\` — avoids network round-trip by reading from local replica on distributed queries
- \`system.query_plan\` (v23.6+) — persisted query plans for analysis across runs`,
  },
  {
    name: 'version-upgrade-advisor',
    description:
      'Advises whether and how to upgrade ClickHouse — versioning scheme, upgrade path, what you gain, pre/post-upgrade checklist.',
    content: `# Version Upgrade Advisor

> **Accuracy note**: This skill covers method, not memorized changelogs. For exact per-version details — new functions, removed settings, default-value changes — always consult the official ClickHouse release notes at clickhouse.com/docs/whats-new/changelog. Never assert specific changelog facts without directing the user to verify them.

## Detect Current Version and Uptime

\`\`\`sql
SELECT version(), uptime();
\`\`\`

The \`get_metrics\` tool also returns the server version in its output — check there first before running a query.

Key things to capture before advising:
- Current version string (e.g. \`24.3.5.46\`)
- Uptime (a long uptime on an old version is a signal the operator avoids upgrades — note this)
- Whether this is a cluster: \`SELECT * FROM system.clusters\` — mixed versions across replicas matter

## How ClickHouse Versioning Works

Format: \`YY.M.patch.build\` — e.g. \`24.3.5.46\` = year 2024, month 3, patch 5.

**Release types**:
- **Regular releases** — monthly, supported until the next regular release (~1 month). Good for tracking latest features; require frequent upgrades.
- **LTS releases** — designated every ~6 months (historically \`.3\` and \`.8\` months); receive backported fixes for ~1 year. The repo's schema matrix (see \`docs/clickhouse-schemas/index.md\`) covers: \`23.3\`, \`23.8\`, \`24.3\`, \`24.8\` as LTS anchors.

**Support window**: LTS releases get security/critical backports for roughly 1 year after release. Regular releases get fixes only until the next release. Running a version past its support window means no patches — upgrade recommended.

**Guidance**: prefer upgrading to the latest LTS if stability matters; track regular releases only if you need cutting-edge features and can upgrade frequently.

## General Upgrade Guidance

1. **One significant line at a time** — do not skip multiple major version lines (e.g. \`23.3\` → \`24.3\` → \`25.3\`, not \`23.3\` → \`25.3\` in one hop). Review the backward-incompatible changes for each intermediate LTS.
2. **Read the changelog first** — ClickHouse marks breaking changes explicitly. Settings that change defaults or are removed are the most common surprises.
3. **Test on staging with production data volumes** — especially joins, aggregations with large state, and any experimental features you use.
4. **Back up before upgrading** — at minimum export table schemas; ideally snapshot data or use replicas as rollback points.
5. **Rolling upgrade for replicated clusters** — upgrade one replica at a time. ClickHouse supports mixed-version replication within the same minor line; check the release notes for the specific hop you are making. Never run permanently mixed-version clusters.
6. **Upgrade ClickHouse Keeper / ZooKeeper in sync** — if using Keeper, check compatibility requirements for the version pair.

## What You Typically Gain by Upgrading

These are broad, stable themes — exact improvements vary by version; verify against release notes.

- **Query optimizer improvements** — planner rewrites, better join ordering, improved predicate pushdown, new join algorithms (e.g. \`grace_hash\`)
- **New functions and data types** — aggregate combinators, JSON support expansions, new numeric/date types, string functions
- **Better compression and storage** — codec improvements, lighter part metadata, faster merges
- **JOIN performance** — hash join improvements, parallel hash, better memory management for large joins
- **Observability** — new columns in \`system.query_log\`, \`system.processes\`, \`system.errors\`; better structured logging
- **Security** — new auth mechanisms, role/row-level security improvements
- **Async inserts and ingest throughput** — deduplication improvements, async insert reliability

Do not cite specific performance numbers or function names without directing the user to verify in the changelog.

## Pre-Upgrade Checklist

Before upgrading, audit the following:

\`\`\`sql
-- 1. Check settings that differ from defaults (non-default = potential conflict)
SELECT name, value, default, changed
FROM system.settings
WHERE changed = 1
ORDER BY name;

-- 2. Check for deprecated settings in use
SELECT name, value
FROM system.settings
WHERE name IN (
  -- populate from the target version's deprecation list; do not hard-code here
);

-- 3. List experimental features in use
SELECT name, value
FROM system.settings
WHERE name LIKE '%experimental%' AND value != '0';

-- 4. Check current errors before upgrade (baseline)
SELECT name, value, last_error_message
FROM system.errors
WHERE value > 0
ORDER BY value DESC
LIMIT 20;

-- 5. Verify replication is healthy (replicated clusters only)
SELECT database, table, replica_name, is_leader,
       log_max_index - log_pointer AS lag
FROM system.replicas
WHERE log_max_index - log_pointer > 0
   OR future_parts > 0;
\`\`\`

Also check:
- Any \`ON CLUSTER\` DDL in flight — let it finish
- Active long-running queries — drain or wait
- Disk space — new versions sometimes need extra space during part rewrite on first startup
- Whether your client library versions support the new server protocol (especially if upgrading a major line)

## Verify After Upgrade

\`\`\`sql
-- Confirm version
SELECT version();

-- Check for new errors since upgrade
SELECT name, value, last_error_message, last_error_time
FROM system.errors
WHERE value > 0
  AND last_error_time > now() - INTERVAL 1 HOUR
ORDER BY value DESC;

-- Confirm replication caught up (clusters)
SELECT database, table, replica_name,
       log_max_index - log_pointer AS lag,
       last_queue_update
FROM system.replicas
ORDER BY lag DESC;

-- Spot-check query performance on known slow queries
-- (run your typical workload; compare system.query_log duration_ms)
SELECT query_id, query, duration_ms
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time > now() - INTERVAL 30 MINUTE
ORDER BY duration_ms DESC
LIMIT 20;
\`\`\`

Smoke test: run a representative SELECT from each critical table, confirm row counts, verify merges are progressing, check \`system.merges\` and \`system.mutations\` have no stalled entries.

## Related Skills

- \`migration-patterns\` — schema migrations and DDL patterns that may be needed alongside an upgrade
- \`clickhouse-best-practices\` — production settings to review after upgrading (defaults may have changed)
- \`hardware-tuning\` — if upgrading unlocks new compression or parallelism settings, revisit resource tuning`,
  },
  {
    name: 'cluster-operations',
    description:
      'Cluster management: distributed tables, ON CLUSTER DDL, node lifecycle, resharding, load balancing, and Keeper migration.',
    content: `# Cluster Operations

## Distributed Tables
- \`CREATE TABLE dist ENGINE = Distributed(cluster, db, local_table, sharding_key)\`
- Sharding key: \`rand()\` for even distribution, \`cityHash64(user_id)\` for user affinity
- Reads: query all shards in parallel; Writes: route to correct shard or write locally

## ON CLUSTER DDL
- \`ALTER TABLE t ON CLUSTER '{cluster}' ADD COLUMN col Type\` — propagate schema to all replicas
- \`CREATE TABLE t ON CLUSTER '{cluster}' AS template_db.template_table\` — clone across shards
- \`distributed_ddl_output_mode\`: \`throw\` (fail on error), \`null\` (ignore), \`none\`, \`active\`
- Check status: \`SELECT * FROM system.distributed_ddl_queue\`

## Load Balancing and Read Routing
- \`load_balancing\`: \`random\`, \`in_order\`, \`first_or_random\`, \`nearest_hostname\`
- \`max_replica_delay_for_distributed_queries\` — skip lagging replicas
- \`fallback_to_stale_replicas_for_distributed_queries=1\` — use stale when all delayed

## Adding Nodes
1. Install ClickHouse on new node
2. Configure Keeper/ZooKeeper connection
3. Update cluster config (\`remote_servers\`) on all nodes
4. Create local tables on new node
5. ReplicatedMergeTree: data syncs automatically; non-replicated: copy or re-insert

## Removing Nodes
1. Stop writes, wait for replication queue to drain
2. \`SYSTEM DROP REPLICA\` for replicated tables
3. Remove from cluster config, restart remaining nodes

## Resharding
- No native online resharding — create new distributed table with new sharding scheme
- \`INSERT INTO new_dist SELECT * FROM old_dist\` or \`clickhouse-copier\` for large migrations

## Cluster Recovery
- \`SYSTEM RESTART REPLICA ON CLUSTER '{cluster}'\` — restart replication across all nodes
- \`SYSTEM SYNC REPLICA ON CLUSTER '{cluster}'\` — force sync from ZooKeeper
- \`SYSTEM FETCH PARTS ON CLUSTER '{cluster}'\` — pull missing parts from other replicas

## Monitoring Clusters
- \`system.clusters\` — topology; \`system.distributed_ddl_queue\` — DDL status; \`system.replicas\` — replication
- Cross-shard queries: use Distributed table or \`remote()\` function

## Keeper Migration (ZooKeeper to ClickHouse Keeper)
1. Deploy ClickHouse Keeper alongside ZooKeeper
2. Snapshot data: \`clickhouse-keeper-converter\` or \`zk-dump.sh\`
3. Configure Keeper with converted snapshot
4. Update \`zookeeper\` config, restart one node at a time
5. Verify replication recovers, then remove ZooKeeper`,
  },
  {
    name: 'troubleshooting',
    description:
      'Diagnose and resolve ClickHouse issues: OOM, slow merges, stuck mutations, query failures with error codes, and systematic error clustering.',
    content: `# Troubleshooting Guide

## OOM (Out of Memory)
**Diagnosis**: \`system.query_log\` WHERE \`memory_usage\` is high. \`system.metrics\` WHERE metric = 'MemoryTracking'.

**Solutions**:
- \`max_memory_usage\` per query (e.g., 10GB), \`max_memory_usage_for_user\` per user
- \`max_bytes_before_external_group_by\` / \`max_bytes_before_external_sort\` for spill-to-disk
- Reduce JOIN sizes with pre-filtering; use SAMPLE for approximate aggregations

## Slow Merges
**Diagnosis**: \`system.merges\` — check \`elapsed\`, \`progress\`, \`total_size_bytes_compressed\`. \`system.part_log\` WHERE event_type = 'MergeParts' for throughput. Too many parts: \`max_parts_count_for_partition\` in \`system.asynchronous_metrics\`.

**Solutions**:
- Increase \`background_pool_size\` (default: 16)
- Check disk I/O via \`system.asynchronous_metrics\` (ReadBufferFromFileDescriptorReadBytes)
- Batch larger inserts to reduce frequency; avoid excessive partitioning
- \`OPTIMIZE TABLE ... FINAL\` to force merge (expensive, off-peak only)

## Stuck Mutations
**Diagnosis**: \`system.mutations\` WHERE is_done = 0 — check \`parts_to_do\`, \`latest_fail_reason\`. Mutations block new merges on affected parts.

**Solutions**:
- \`KILL MUTATION WHERE mutation_id = '...'\` to cancel
- Fix underlying issue (schema mismatch, disk space), then re-submit
- Prefer INSERT + ReplacingMergeTree over UPDATE mutations

## Query Failures
**Diagnosis**: \`system.query_log\` WHERE type = 'ExceptionWhileProcessing'. Use error clustering to find patterns:
\`\`\`sql
SELECT exception_code, count(), topK(10)(exception)
FROM system.query_log
WHERE type = 'ExceptionWhileProcessing'
GROUP BY exception_code ORDER BY count() DESC
\`\`\`
For persistent errors, check \`system.error_log\` (requires error logging enabled).

**Common error codes**:
- **60**: table not found — verify table exists, check database name
- **47**: unknown column — use \`get_table_schema\` to check column names
- **241**: memory limit — reduce scope, add LIMIT, use SAMPLE
- **159**: timeout — add time filters, use LIMIT
- **252**: too many parts — wait for merges or OPTIMIZE

## Network Connectivity
**Diagnosis**: Check inter-server connectivity for replication or distributed queries. Verify \`interserver_http_port\` is reachable between nodes. Test with \`curl http://<peer>:9009\`. Check firewall rules and DNS resolution.

## Cross-references
- Load the \`replication-guide\` skill for replication lag diagnosis and recovery.
- Load the \`storage-optimization\` skill for disk recovery and tiered storage management.`,
  },
  {
    name: 'hardware-tuning',
    description:
      'Detect server cores/RAM/disk from system tables, then recommend ClickHouse settings sized to that hardware.',
    content: `# Hardware Tuning

Load this skill when the user asks "what settings should I change given my server's hardware?" or similar. The workflow is always: detect first, recommend second. Never recommend a specific byte value as a universal truth — give ratios and explain the reasoning.

## Detect Hardware

Metric names vary by ClickHouse version. Use broad \`ILIKE\` patterns and inspect what is actually returned before drawing conclusions.

\`\`\`sql
-- Step 1: Discover what CPU/memory metrics are available on this server
SELECT metric, value
FROM system.asynchronous_metrics
WHERE metric ILIKE '%CPU%'
   OR metric ILIKE '%Memory%'
   OR metric ILIKE '%core%'
ORDER BY metric
\`\`\`

Key metrics to look for (names differ across versions):

| What you need | Likely metric names |
|---|---|
| Logical CPU cores | \`CGroupMaxCPU\`, \`OSCPUVirtualTimeMicroseconds\` (indirect), check also \`system.metrics\` \`CPUUsage*\` |
| Total RAM | \`OSMemoryTotal\`, \`CGroupMemoryLimit\` |
| Available RAM | \`OSMemoryAvailable\`, \`OSMemoryFreeWithoutCache\` |
| Used RAM | \`OSMemoryUsed\`, \`MemoryResident\` |

> If neither \`CGroupMaxCPU\` nor an obvious cores metric appears, fall back to counting CPU entries from \`/proc/cpuinfo\` via \`SELECT count() FROM system.asynchronous_metrics WHERE metric ILIKE '%CPU%User%'\` or ask the user directly. Do not fabricate a core count.

\`\`\`sql
-- Step 2: Disk layout — free space and total per disk
SELECT name, path, type,
       formatReadableSize(free_space)  AS free,
       formatReadableSize(total_space) AS total,
       round((1 - free_space / total_space) * 100, 1) AS used_pct
FROM system.disks
ORDER BY total_space DESC
\`\`\`

## Read Current Settings

Pull the most hardware-sensitive settings so you can compare current vs. recommended:

\`\`\`sql
SELECT name, value, changed, default AS default_value, description
FROM system.settings
WHERE name IN (
    'max_threads',
    'max_insert_threads',
    'max_memory_usage',
    'max_memory_usage_for_user',
    'max_server_memory_usage',
    'max_server_memory_usage_to_ram_ratio',
    'max_bytes_before_external_group_by',
    'max_bytes_before_external_sort',
    'max_bytes_before_external_join',
    'background_pool_size',
    'background_merge_pool_size',
    'background_fetches_pool_size',
    'mark_cache_size',
    'uncompressed_cache_size',
    'max_concurrent_queries',
    'max_connections'
)
ORDER BY name
\`\`\`

Note: \`background_pool_size\` and \`background_merge_pool_size\` are server-level settings (set in \`config.xml\` or \`config.d/\`). They will appear in \`system.settings\` but changing them requires a server restart. Session-level settings take effect immediately with \`SET\`.

## Key Settings: Ratio-Based Guidance

Use the detected hardware values from the queries above and apply these ratios. Replace \`<cores>\` and \`<RAM_bytes>\` with the actual numbers you found.

### CPU-bound settings

| Setting | Scope | Guidance |
|---|---|---|
| \`max_threads\` | session | ≈ number of logical cores. Default is auto (\`0\`). Only lower it if queries compete with each other at high concurrency. |
| \`max_insert_threads\` | session | 1–4 for normal inserts; up to half of cores for bulk loads. |
| \`background_pool_size\` | server (restart) | 16 is the default; for merge-heavy workloads raise toward \`cores / 2\`. Don't exceed cores. |
| \`background_merge_pool_size\` | server (restart) | Same guidance as \`background_pool_size\`. Default 16. |
| \`max_concurrent_queries\` | server | Start at \`cores * 2\`. Lower if queries are large and memory-bound. |

### Memory-bound settings

Leave genuine headroom — never allocate 100 % of RAM to ClickHouse. The OS, kernel buffers, and other processes need room.

| Setting | Scope | Guidance |
|---|---|---|
| \`max_server_memory_usage\` | server | Set to \`0\` (auto) to use \`max_server_memory_usage_to_ram_ratio\` instead. If hardcoding: ≤ 80 % of \`OSMemoryTotal\`. |
| \`max_server_memory_usage_to_ram_ratio\` | server | Default \`0.9\`; consider lowering to \`0.8\` on shared hosts or when running replicas with ZooKeeper on the same box. |
| \`max_memory_usage\` | session | Per-query cap. A common starting point is \`RAM × 0.3\` for OLAP queries, but tune per workload. |
| \`max_memory_usage_for_user\` | session | Per-user sum cap. Useful when multiple users share the server; set to \`RAM × 0.5\` as a starting point. |
| \`max_bytes_before_external_group_by\` | session | Spill threshold for GROUP BY. Typically half of \`max_memory_usage\`. If set to \`0\`, spilling is disabled. |
| \`max_bytes_before_external_sort\` | session | Same pattern as external group by. Setting this too low causes unnecessary disk spilling; too high causes OOM. |
| \`max_bytes_before_external_join\` | session | Applies to hash joins. Same ratio guidance. |

### Cache settings (server-level, config.xml or \`<cache>\` section)

These affect how much RAM is reserved for ClickHouse's internal caches. Changing them requires restart.

| Setting | Guidance |
|---|---|
| \`mark_cache_size\` | Default 5 GiB. For servers with lots of RAM (≥ 64 GiB) and many columns, raise to 10–20 GiB. Do not exceed ≈ 10 % of RAM. |
| \`uncompressed_cache_size\` | Default 0 (disabled). Only enable if you have a read-heavy workload with repeated small queries on the same columns. Cap at ≈ 5–10 % of RAM. |

## Disk Considerations

After running the disk query above:

- **Single spinning disk**: reduce \`background_pool_size\` and \`background_merge_pool_size\` to avoid I/O saturation during merges. Values of 4–8 are common.
- **NVMe / SSD array**: defaults or higher pool sizes are fine.
- **Tiered storage (hot/cold)**: ensure the hot tier has enough free space for active merges (ClickHouse needs ≈ 2× the size of the parts being merged).
- **Disk nearly full (> 90 % used)**: inserts will stall. Investigate via \`system.parts\` and consider \`OPTIMIZE … FINAL\` or archiving old partitions before tuning anything else.

## Caution

- **Change one setting at a time** and measure before moving to the next.
- **Defaults are often correct.** ClickHouse auto-detects cores and sets \`max_threads = 0\` (auto). Only override when you have a concrete reason.
- **Server-level vs. session-level**: \`background_pool_size\`, \`mark_cache_size\`, \`max_server_memory_usage\`, and \`max_concurrent_queries\` require editing \`config.xml\` (or a file in \`config.d/\`) and restarting the server. Session-level settings (\`max_threads\`, \`max_memory_usage\`, etc.) apply immediately with \`SET\` or in the query profile.
- **Replicated environments**: changing server-level settings must be applied consistently to all replicas. Inconsistent pool sizes can cause one replica to fall behind on merges.
- **ClickHouse Keeper / ZooKeeper on the same host**: the coordination process can consume significant RAM under load. Budget at least 4–8 GiB for it and reduce \`max_server_memory_usage_to_ram_ratio\` accordingly.

## Verification

After applying changes, confirm they took effect and watch for regressions:

\`\`\`sql
-- Confirm the setting is now the value you set (session-level)
SELECT name, value, changed
FROM system.settings
WHERE name IN ('max_threads', 'max_memory_usage', 'max_bytes_before_external_group_by')

-- Watch for OOM or memory-allocation errors after a change
SELECT name, value AS error_count, last_error_time, last_error_message
FROM system.errors
WHERE name ILIKE '%Memory%' OR name ILIKE '%Alloc%'
ORDER BY last_error_time DESC
LIMIT 20

-- Monitor peak memory usage on currently running queries
SELECT query_id, user, memory_usage, peak_memory_usage,
       formatReadableSize(memory_usage)      AS mem,
       formatReadableSize(peak_memory_usage) AS peak_mem,
       elapsed,
       substring(query, 1, 120)              AS query
FROM system.processes
WHERE query NOT LIKE '%processes%'
ORDER BY peak_memory_usage DESC
\`\`\`

If \`system.errors\` shows \`MEMORY_LIMIT_EXCEEDED\` spikes after a change, roll back that setting before adjusting others.

## Cross-references

- \`clickhouse-best-practices\` — production insert, cache, and connection-pool guidance
- \`schema-design-advisor\` — part counts and merge behavior affect background pool sizing
- \`troubleshooting\` — error-code-driven diagnosis including OOM and disk-full incidents
- \`query-tuning-advisor\` — per-query memory and parallelism knobs once server settings are stable`,
  },
  {
    name: 'concept-explainer',
    description:
      'Explains core ClickHouse concepts with accurate mental models — MergeTree, indexes, replication, sharding, and special engines.',
    content: `# ClickHouse Concept Explainer

Use this skill when a user asks "what is X", "explain Y", or "how does Z work". Give the right mental model first, add a concrete example, then offer to go deeper. Tailor detail to the user's apparent experience level.

## MergeTree Family & How Merges Work

Every insert creates one or more immutable **parts** on disk (a directory of column files + index). ClickHouse merges these parts in the background — combining small parts into larger ones, re-sorting data, applying deduplication or aggregation depending on the engine variant. Until a merge happens, the same logical row may exist across multiple parts.

**Why small inserts are bad**: each INSERT of 10 rows creates a tiny part. Parts accumulate faster than the background merger can keep up, hitting the \`too many parts\` error (default threshold: 300 parts per partition). Always batch at least 1 000–10 000 rows per insert; use async inserts for high-frequency small writes.

\`\`\`sql
-- Check live part counts per table
SELECT table, count() AS parts, sum(rows) AS total_rows
FROM system.parts
WHERE active AND database = currentDatabase()
GROUP BY table ORDER BY parts DESC;
\`\`\`

Cross-reference: \`clickhouse-best-practices\` for insert batching settings.

## Sparse Primary Index / Primary Key

ClickHouse does **not** build a per-row B-tree index. Instead it stores one index entry per **granule** (default 8 192 rows, set by \`index_granularity\`). Each entry records the primary key value at the start of that granule.

At query time ClickHouse binary-searches these sparse marks, selects the minimal set of granules that could match, and reads only those blocks from disk. The primary key is **not unique** — duplicates are allowed and common. Its sole purpose is to sort data on disk so range scans skip irrelevant granules.

\`\`\`sql
-- Effective only when filtering on leading primary-key columns:
SELECT count() FROM events WHERE user_id = 42 AND event_date >= today() - 7;
-- user_id must be the first or second ORDER BY column to benefit from the index.
\`\`\`

Cross-reference: \`query-optimization\` for \`EXPLAIN INDEXES\` and skip indexes.

## ORDER BY vs PARTITION BY vs PRIMARY KEY

These three clauses look similar but serve different purposes:

| Clause | Role |
|---|---|
| \`ORDER BY (a, b)\` | Physical sort order within each part; **defines the primary key** by default |
| \`PARTITION BY expr\` | Splits data into independent sub-trees; each partition has its own parts |
| \`PRIMARY KEY (a)\` | Override the index prefix (rarely needed; defaults to full \`ORDER BY\`) |

**Partitioning rule of thumb**: partition on a low-cardinality column (e.g., \`toYYYYMM(date)\`). Each partition is merged independently; over-partitioning (millions of partitions) slows queries and maintenance. Most tables need no explicit \`PARTITION BY\` or just a monthly/daily date partition.

Cross-reference: \`schema-design-advisor\` for partition sizing guidance.

## Columnar Storage & Compression

ClickHouse stores each column in its own file. A query reading only 3 out of 100 columns touches ~3% of the data. Within a column file, values are stored consecutively, so they compress extremely well — identical or slowly-changing values in sorted data often achieve 5–20× compression with LZ4 (default) or ZSTD.

Per-column codecs let you tune further:

\`\`\`sql
CREATE TABLE metrics (
    ts    DateTime CODEC(DoubleDelta, ZSTD),  -- timestamps: delta + entropy coding
    value Float64  CODEC(Gorilla, ZSTD)       -- float series: XOR delta
) ENGINE = MergeTree ORDER BY ts;
\`\`\`

This is why ClickHouse wins on analytical queries: it reads far less data off disk than row-oriented databases, and what it does read is compact.

## Replication

\`ReplicatedMergeTree\` keeps two or more replicas in sync through **ClickHouse Keeper** (or ZooKeeper). The coordination protocol works like this:

1. One replica receives an insert, writes a part locally, and **logs the operation** to Keeper.
2. Other replicas see the log entry and fetch the part (either from the leader or from each other).
3. Each replica applies merges independently but uses Keeper to agree on **which parts to merge** so they converge to identical state.

Replication is **eventually consistent**: a fresh replica may not yet have a just-inserted row. Use \`SYSTEM SYNC REPLICA\` to wait for a replica to catch up, or enable \`insert_quorum\` to make inserts wait for N replicas before acknowledging.

Cross-reference: \`replication-guide\` for quorum settings and Keeper health checks.

## Sharding & Distributed Tables

**Shard**: an independent subset of data, typically one \`ReplicatedMergeTree\` table (with its own replicas). Sharding is horizontal scaling — more shards = more total data capacity and parallelism.

**Distributed engine**: a virtual table that fans out queries to all shards and merges results. It stores no data itself.

\`\`\`sql
CREATE TABLE events_dist AS events
ENGINE = Distributed('my_cluster', currentDatabase(), 'events', rand());
-- rand() = random shard key; replace with cityHash64(user_id) for colocation
\`\`\`

A write to the \`Distributed\` table is routed to one shard (per the shard key). A \`SELECT\` is broadcast to all shards and results are merged on the query initiator. Use \`GLOBAL JOIN\` when joining a Distributed table against another, to avoid N×M fan-out.

Cross-reference: \`cluster-operations\` for cluster topology and \`query-optimization\` for GLOBAL JOIN.

## Materialized Views & Projections

Both compute derived data automatically on insert, but they serve different purposes:

**Materialized view**: an independent table populated by a trigger query that runs on every insert into the source table. Use for pre-aggregating into a separate table, routing subsets to different engines, or transforming schemas.

\`\`\`sql
CREATE MATERIALIZED VIEW hourly_counts
ENGINE = SummingMergeTree ORDER BY (hour, event)
AS SELECT toStartOfHour(ts) AS hour, event, count() AS cnt
FROM events GROUP BY hour, event;
\`\`\`

**Projection**: an alternative sort order or pre-aggregation stored *inside* the same table. ClickHouse automatically picks the best projection at query time. Projections update atomically with the parent table and stay consistent across replicas.

Use projections when you want a secondary sort key without managing a separate table. Use materialized views when you need a different engine, schema, or destination cluster.

## Special MergeTree Engine Variants

| Engine | Problem it solves |
|---|---|
| \`ReplacingMergeTree(ver)\` | Keeps only the latest version of a row with the same primary key (deduplication). Final dedup happens at merge time or with \`FINAL\`; duplicates may be visible until then. |
| \`AggregatingMergeTree\` | Stores partial aggregation states (e.g., \`AggregateFunction(sum, UInt64)\`) so that merges combine states rather than raw rows. Typically used as the target of a materialized view. |
| \`SummingMergeTree(cols)\` | Sums specified numeric columns during merges for rows with identical primary key. Simple pre-aggregation without partial states. |
| \`CollapsingMergeTree(sign)\` | Cancels rows by pairing a \`sign=1\` (insert) row with a \`sign=-1\` (delete/update) row sharing the same primary key. Merges collapse the pair to nothing. Used for update-heavy fact tables. |

All variants still inherit the full MergeTree behaviour (parts, background merges, sparse index). They differ only in what happens **during** a merge.

## PREWHERE vs WHERE

\`PREWHERE\` is read first, on only the columns it references, before the rest of the row is decoded. \`WHERE\` is evaluated after all selected columns are read. Use \`PREWHERE\` for highly selective conditions on narrow columns to skip reading wide columns for most rows. ClickHouse applies this optimization automatically for simple conditions when \`optimize_move_to_prewhere = 1\` (default on).

\`\`\`sql
-- Manual hint: filter on the cheap column first, avoid reading \`payload\` for 99% of rows
SELECT payload FROM events PREWHERE event = 'purchase' WHERE amount > 1000;
\`\`\`

---

*Ask follow-up questions to go deeper on any concept. For query tuning see \`query-optimization\`; for schema choices see \`schema-design-advisor\`; for cluster topology see \`cluster-operations\` and \`replication-guide\`.*`,
  },
  {
    name: 'query-tuning-advisor',
    description:
      'Diagnose a slow or expensive query with EXPLAIN and query_log, then propose concrete rewrites and better join strategies.',
    content: `# Query Tuning Advisor

Use this skill when a user shares a specific slow, expensive, or high-memory query and wants it made faster. The goal is a concrete **before → after** rewrite, not general advice. Load \`query-optimization\` for reference tables on EXPLAIN output and skip index types.

## 1. Diagnose First

Never guess. Collect evidence before proposing rewrites.

**Step 1 — EXPLAIN INDEXES** (call \`explain_query\` tool, type \`INDEXES\`):
\`\`\`sql
EXPLAIN INDEXES = 1 <the query>
\`\`\`
Read the output for:
- \`Granules: N/M\` — N granules selected out of M total. N ≈ M means a full scan; skip indexes are not firing.
- \`Keys: <expr>\` — confirms which primary key ranges were used.
- Missing keys = predicates don't align with the table's \`ORDER BY\`.

**Step 2 — EXPLAIN PLAN** (type \`PLAN\`, actions=1):
\`\`\`sql
EXPLAIN actions = 1 <the query>
\`\`\`
Look for: \`Filter\`, \`ReadFromMergeTree\` with no pushdown, large \`Aggregating\` steps, or a \`JOIN\` where the build side is large.

**Step 3 — Find it in query_log** (call \`query\` tool):
\`\`\`sql
SELECT
    query_duration_ms,
    read_rows,
    result_rows,
    read_rows / nullIf(result_rows, 0) AS scan_ratio,
    memory_usage,
    ProfileEvents['SelectedMarks']        AS marks_read,
    ProfileEvents['SelectedRangesOfMarks'] AS ranges_read,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND normalized_query_hash = cityHash64('<the query with literals replaced by ?>')
ORDER BY event_time DESC
LIMIT 5
\`\`\`
Key signals:
- \`scan_ratio\` > 100 → reading far more rows than returned; likely full scan or missing PREWHERE.
- \`marks_read\` close to total table marks → primary key not used.
- \`memory_usage\` > 1 GiB → GROUP BY or JOIN materializing too much.

---

## 2. PREWHERE and Predicate Placement

ClickHouse evaluates \`PREWHERE\` before reading all columns — it reads only the filter column(s) first, skips non-matching granules, then fetches the rest. The optimizer promotes simple \`WHERE\` conditions automatically, but it doesn't always get it right.

**Rules:**
- Move the most selective, cheapest-to-read condition into \`PREWHERE\` manually when the optimizer misses it.
- Avoid expressions in \`PREWHERE\` that reference non-stored columns or require decompression of wide columns.
- Never use \`PREWHERE\` with \`FINAL\` on a ReplacingMergeTree — it can produce wrong results.

\`\`\`sql
-- Before
SELECT url, status, body
FROM access_log
WHERE toDate(event_time) = today()
  AND status = 500

-- After: push the narrow int filter to PREWHERE
SELECT url, status, body
FROM access_log
PREWHERE status = 500
WHERE toDate(event_time) = today()
\`\`\`

Also: move date/time range filters to align with the primary key order so they prune granules before PREWHERE even runs.

---

## 3. Better JOINs

### Join order
ClickHouse's hash join builds a hash table from the **right** table and probes with the **left** table. Put the **smaller** table on the right.

\`\`\`sql
-- Before: large table on right (built into hash table)
SELECT * FROM small_dim JOIN large_fact USING (id)

-- After: large table on left (probed), small on right (built)
SELECT * FROM large_fact JOIN small_dim USING (id)
\`\`\`

### Choose the right join_algorithm

| Situation | Setting |
|---|---|
| Right table fits in memory (default, < ~few GB) | \`join_algorithm = 'hash'\` |
| Right table too large for RAM | \`join_algorithm = 'partial_merge'\` (spills to disk) |
| Both sides sorted on join key | \`join_algorithm = 'full_sorting_merge'\` (no hash table) |
| ClickHouse should decide | \`join_algorithm = 'auto'\` (v22.9+) |
| Distributed query, right table is small | \`GLOBAL JOIN\` (broadcasts right table to all shards) |

Set per-query: \`SELECT ... FROM a JOIN b USING (k) SETTINGS join_algorithm = 'partial_merge'\`

### IN / semi-join instead of JOIN

When you only need to filter rows (not project columns from the right side), \`IN\` is cheaper than \`JOIN\` — it avoids materializing the joined columns:

\`\`\`sql
-- Before: full JOIN just to filter
SELECT l.* FROM orders l JOIN vip_customers r ON l.customer_id = r.id

-- After: semi-join via IN
SELECT * FROM orders WHERE customer_id IN (SELECT id FROM vip_customers)
\`\`\`

### Avoid cartesian blowups

- Always specify \`ON\` or \`USING\`. A missing condition produces a cross join.
- Check \`read_rows\` in query_log — if it equals \`left_rows × right_rows\`, you have a cartesian product.
- For many-to-many relationships, pre-aggregate one side before joining.

---

## 4. Avoiding Full Scans

### Align filters with ORDER BY / primary key

ClickHouse primary key = \`ORDER BY\` columns. Filters on those columns prune granules; filters on other columns scan everything.

\`\`\`sql
-- Table: ORDER BY (tenant_id, event_date, event_type)
-- Bad: event_type filter alone cannot prune granules
WHERE event_type = 'purchase'

-- Good: leading columns first, then event_type
WHERE tenant_id = 42 AND event_date >= '2024-01-01' AND event_type = 'purchase'
\`\`\`

### Skip indexes

Add a skip index when you often filter on a non-primary-key column:

\`\`\`sql
-- For low-cardinality status columns
ALTER TABLE events ADD INDEX idx_status (status) TYPE set(100) GRANULARITY 4;

-- For high-cardinality string equality (e.g. trace_id)
ALTER TABLE events ADD INDEX idx_trace (trace_id) TYPE bloom_filter GRANULARITY 1;

-- For range queries on a secondary numeric column
ALTER TABLE events ADD INDEX idx_latency (latency_ms) TYPE minmax GRANULARITY 4;
\`\`\`

After adding, materialize: \`ALTER TABLE events MATERIALIZE INDEX idx_status;\`

Verify it fires: \`EXPLAIN INDEXES = 1 <query>\` — look for the index name in the output and a reduced granule count.

---

## 5. Aggregation Tuning

- **Avoid \`SELECT *\`** in aggregation queries — fetch only the columns you aggregate or group on.
- **Push \`LIMIT\` down**: use \`LIMIT\` in subqueries and CTEs to cap intermediate sets before joining or grouping.
- **Use approximate functions** when exactness isn't required:
  - \`uniqHLL12(x)\` instead of \`uniq(x)\` or \`COUNT(DISTINCT x)\` — ~1% error, 10× less memory.
  - \`quantileTDigest(0.95)(latency)\` instead of \`quantile(0.95)(latency)\` — mergeable, streaming-friendly.
  - \`topK(10)(x)\` instead of \`GROUP BY x ORDER BY count() DESC LIMIT 10\` for heavy-hitter approximation.
- **GROUP BY memory**: if \`memory_usage\` is high on aggregation, try \`max_bytes_before_external_group_by\` to spill to disk, or switch to two-level aggregation with \`group_by_two_level_threshold\`.
- **Pre-aggregate with materialized views**: if the same aggregation runs frequently, maintain a \`SummingMergeTree\` or \`AggregatingMergeTree\` target and query that instead.

---

## 6. Before → After Worked Example

**User reports**: "This query takes 45 seconds and reads 2 billion rows."

\`\`\`sql
-- BEFORE
SELECT
    user_id,
    COUNT(*) AS cnt,
    uniq(session_id) AS sessions
FROM events
JOIN users ON events.user_id = users.id
WHERE event_type = 'page_view'
  AND toYear(event_time) = 2024
GROUP BY user_id
ORDER BY cnt DESC
LIMIT 100
\`\`\`

**Diagnosis:**
1. \`EXPLAIN INDEXES\` shows \`Granules: 9800/9800\` → full scan (event_type not in ORDER BY).
2. \`uniq(session_id)\` in query_log shows \`memory_usage = 3.2 GiB\`.
3. \`users\` is 50 M rows — large right table.

**After:**
\`\`\`sql
-- AFTER
SELECT
    user_id,
    COUNT(*) AS cnt,
    uniqHLL12(session_id) AS sessions   -- ~1% error, 10x less memory
FROM events
PREWHERE event_type = 'page_view'       -- PREWHERE prunes granules early
WHERE event_time >= '2024-01-01'        -- aligns with ORDER BY (event_time in PK)
  AND event_time <  '2025-01-01'
GROUP BY user_id
ORDER BY cnt DESC
LIMIT 100
-- users JOIN removed: not needed for this output
\`\`\`

**Rationale:**
- \`PREWHERE event_type\` reads only the narrow column first, skips non-matching granules.
- Date range on \`event_time\` (primary key leading column) prunes ~90% of granules.
- \`uniqHLL12\` cuts aggregation memory from 3.2 GiB to ~300 MiB.
- \`JOIN users\` removed — user_id is already in \`events\`, users columns not projected.

---

## 7. Tuning Checklist

Run through this when asked "make this query faster":

- [ ] \`EXPLAIN INDEXES\` — are granules being pruned? If \`N ≈ M\`, filters don't hit primary key.
- [ ] \`EXPLAIN PLAN\` — is there a large build-side JOIN? A fat Aggregating step?
- [ ] \`query_log\` — check \`scan_ratio\` (read_rows / result_rows) and \`memory_usage\`.
- [ ] Filters on primary key leading columns? If not, reorder WHERE or add skip index.
- [ ] \`PREWHERE\` on the most selective cheap column?
- [ ] JOIN: smaller table on the right? Right \`join_algorithm\` for table sizes?
- [ ] Can \`JOIN\` be replaced by \`IN\` (semi-join) if right-side columns aren't projected?
- [ ] \`SELECT *\` → replace with explicit column list.
- [ ] \`uniq()\` / \`COUNT(DISTINCT)\` → \`uniqHLL12()\` if approximate is fine.
- [ ] \`quantile()\` → \`quantileTDigest()\` for percentile aggregations.
- [ ] Frequent aggregation → candidate for a materialized view pre-aggregation.
- [ ] Date arithmetic in WHERE (\`toYear(ts) = 2024\`) → replace with range filter on raw column.

---

## Cross-references
- \`query-optimization\` — EXPLAIN output reference, ProfileEvents counters, optimizer settings.
- \`schema-design-advisor\` — fixing slow queries at the schema level (ORDER BY, partition key, skip indexes at table creation).
- \`data-analysis\` — exploratory SQL patterns for understanding data shape before tuning.
- \`system-tables-reference\` — exact column names for \`system.query_log\`, \`system.processes\`.`,
  },
  {
    name: 'security-hardening',
    description:
      'RBAC configuration, row policies, quotas, network security, audit logging, and access control best practices.',
    content: `# Security Hardening

## RBAC (Role-Based Access Control)
- Create roles: \`CREATE ROLE analyst\`
- Grant permissions: \`GRANT SELECT ON db.* TO analyst\`
- Assign to users: \`GRANT analyst TO user1\`
- Hierarchical: roles can inherit from other roles
- Check grants: \`SHOW GRANTS FOR user1\`
- Inspect user: \`SHOW CREATE USER username\`
- Password rotation: \`ALTER USER username IDENTIFIED BY 'new_password'\`

## Row Policies
- Restrict row access per user: \`CREATE ROW POLICY p ON db.table FOR SELECT USING tenant_id = currentUser()\`
- Policies are AND-ed together
- Use for multi-tenant data isolation
- Check policies: \`system.row_policies\`

## Quotas
- Limit resource usage per user/IP: \`CREATE QUOTA q FOR user1 ... LIMIT max_queries = 100\`
- Quota intervals: per hour, per day, etc.
- Limits: max_queries, max_result_rows, max_read_rows, max_execution_time
- Monitor: \`system.quota_usage\`

## Network Security
- Restrict user access by IP: \`CREATE USER u HOST IP '10.0.0.0/8'\`
- Use TLS for client connections
- Inter-server encryption for replication
- Separate ports for internal vs external access

## Audit Logging
- Enable \`system.session_log\` for login tracking
- \`system.query_log\` records all queries with user info
- \`system.text_log\` for server-level events
- Configure log retention with TTL

## Best Practices
- Principle of least privilege — grant only needed permissions
- Use roles, not direct user grants
- Separate read-only and admin users
- Enable quotas for all non-admin users
- Regular audit of grants and access patterns
- Use \`readonly = 1\` setting for monitoring connections`,
  },
  {
    name: 'schema-design-advisor',
    description:
      'Recommend table ORDER BY keys, partition strategies, column data-type right-sizing, codecs, skip indexes, and projections for ClickHouse tables.',
    content: `# Schema Design Advisor

Replaces the removed \`recommend_table_design\` tool. Follow the sections below in order: inspect first, then recommend.

## Inspect First

Gather evidence before making any recommendation. Run all three in parallel.

**1. Schema** — call \`get_table_schema\` for the target table.

**2. Parts summary** — call \`get_table_parts\`, or:

\`\`\`sql
SELECT
    partition,
    count()                                                 AS part_count,
    sum(rows)                                               AS total_rows,
    formatReadableSize(sum(data_compressed_bytes))          AS compressed,
    formatReadableSize(sum(data_uncompressed_bytes))        AS uncompressed,
    round(sum(data_uncompressed_bytes) /
          nullIf(sum(data_compressed_bytes), 0), 2)        AS ratio
FROM system.parts
WHERE active AND database = 'db' AND table = 't'
GROUP BY partition
ORDER BY partition DESC
LIMIT 20
\`\`\`

**3. Per-column compression + cardinality** — run via \`query\`:

\`\`\`sql
SELECT
    name,
    type,
    formatReadableSize(data_compressed_bytes)               AS compressed,
    formatReadableSize(data_uncompressed_bytes)             AS uncompressed,
    round(data_uncompressed_bytes /
          nullIf(data_compressed_bytes, 0), 2)              AS ratio,
    compression_codec
FROM system.columns
WHERE database = 'db' AND table = 't'
ORDER BY data_uncompressed_bytes DESC
\`\`\`

**4. Cardinality probe** (spot-check suspicious columns):

\`\`\`sql
SELECT
    uniq(col_a)  AS card_a,
    uniq(col_b)  AS card_b,
    count()      AS total
FROM db.t
\`\`\`

A ratio < 2× on per-column compression usually means the wrong codec or wrong type. Cardinality drives type and codec choices below.

---

## ORDER BY / Primary Key Design

- **Rule**: list columns low-cardinality → high-cardinality in the \`ORDER BY\` clause.
- Common ordering: \`(tenant_id, date, entity_id, event_id)\`.
- Only the first N columns of \`ORDER BY\` form the sparse index (granule size 8192 rows by default). Columns later in the key still sort data but don't speed up point lookups.
- **Filter alignment**: include in \`ORDER BY\` every column that appears in \`WHERE\` clauses of your most frequent queries — leftmost first.
- \`PRIMARY KEY\` can be a prefix of \`ORDER BY\` if you want to deduplicate on a broader key (ReplacingMergeTree / CollapsingMergeTree).
- Avoid putting high-cardinality UUIDs first — they destroy index locality.
- When two columns have similar cardinality, put the one queried with \`=\` before the one queried with \`BETWEEN\`/range.

---

## Partition Key Choices

| Granularity | DDL | When to use |
|---|---|---|
| Monthly | \`PARTITION BY toYYYYMM(event_date)\` | Most time-series tables; 1–12 partitions/year |
| Daily | \`PARTITION BY toYYYYMMDD(event_date)\` | Only when you routinely DROP whole days and have < 1000 partitions total |
| By tenant | \`PARTITION BY (tenant_id, toYYYYMM(event_date))\` | Multi-tenant with per-tenant data lifecycle |

**Too-many-partitions warning**: ClickHouse merges within a partition, not across. More than ~1000 active partitions per table degrades insert and merge performance (each insert touches one partition; too many partitions = many small parts). Daily partitioning on a high-volume table quickly exceeds safe limits.

Check current partition count:
\`\`\`sql
SELECT count(DISTINCT partition) FROM system.parts
WHERE active AND database = 'db' AND table = 't'
\`\`\`

If > 500, recommend coarser partitioning.

---

## Column Data-Type Right-Sizing

### Integer width

| Value range | Type |
|---|---|
| 0–255 | \`UInt8\` |
| 0–65535 | \`UInt16\` |
| 0–4 billion | \`UInt32\` |
| > 4 billion or unknown | \`UInt64\` |
| Negative small | \`Int8\`/\`Int16\`/\`Int32\` |

Use the narrowest type that fits the actual data range (query \`max(col)\`, \`min(col)\`). Narrower types compress better and fit more values per granule.

### Strings

| Situation | Type |
|---|---|
| cardinality < ~10 000 distinct values | \`LowCardinality(String)\` |
| cardinality > ~100 000 | plain \`String\` — LC overhead outweighs benefit |
| fixed-width binary/hash (e.g. MD5) | \`FixedString(16)\` (store raw bytes, not hex) |
| small, known set of values | \`Enum8\` or \`Enum16\` (saves space + enforces valid values) |

\`LowCardinality\` stores a dictionary per column chunk; high-cardinality columns with LC can use more memory than \`String\`.

### Dates and timestamps

| Need | Type |
|---|---|
| Date only (day precision) | \`Date\` (2 bytes) |
| Second precision, 1970–2105 | \`DateTime\` (4 bytes) |
| Sub-second or timezone | \`DateTime64(3)\` / \`DateTime64(6)\` (8 bytes) |

Avoid \`String\` for timestamps — they block time-based pruning and sort incorrectly.

### Nullable

Avoid \`Nullable(T)\` unless the column genuinely contains NULLs that have semantic meaning. \`Nullable\` adds a hidden bitmask column and disables some optimizations (skip indexes, certain codecs). Use a sentinel value (0, empty string, epoch) and document the convention instead.

### How to recommend a type change

1. Query \`max(col)\`, \`min(col)\`, \`uniq(col)\`, \`countIf(col IS NULL)\` to measure range, cardinality, and null rate.
2. Pick the narrowest correct type from the tables above.
3. Check if existing queries rely on implicit casting (e.g. comparing \`String\` column to integer literal).
4. Emit the ALTER:

\`\`\`sql
ALTER TABLE db.t MODIFY COLUMN col_name NewType;
\`\`\`

For large tables this is a background mutation — monitor via \`system.mutations\`.

---

## Compression Codecs

| Data shape | Recommended codec |
|---|---|
| Monotonically increasing integers (timestamps, IDs) | \`Delta, ZSTD(3)\` |
| Slow-changing counters | \`DoubleDelta, ZSTD(3)\` |
| Floating-point gauge metrics | \`Gorilla, ZSTD(3)\` |
| Integer columns with small value range | \`T64, ZSTD(3)\` |
| Random strings / UUIDs | \`ZSTD(3)\` or \`LZ4\` |
| Already-compressed blobs | \`NONE\` |

Apply per column:

\`\`\`sql
ALTER TABLE db.t MODIFY COLUMN ts DateTime CODEC(DoubleDelta, ZSTD(3));
ALTER TABLE db.t MODIFY COLUMN value Float64 CODEC(Gorilla, ZSTD(3));
ALTER TABLE db.t MODIFY COLUMN status LowCardinality(String) CODEC(ZSTD(3));
\`\`\`

\`ZSTD(3)\` is a safe default when unsure. \`LZ4\` is faster to decompress at the cost of compression ratio. Benchmark with \`SELECT formatReadableSize(data_compressed_bytes), formatReadableSize(data_uncompressed_bytes) FROM system.columns WHERE ...\` before and after.

---

## Skip Indexes

Add skip indexes to columns that appear in \`WHERE\` but are not in the \`ORDER BY\` prefix.

| Index type | Best for | Example |
|---|---|---|
| \`minmax\` | Numeric ranges, dates | \`error_code\`, \`response_time\` |
| \`set(N)\` | Low-cardinality columns (≤ N distinct values per granule) | \`status\`, \`region\` |
| \`bloom_filter\` | String equality / IN on medium-cardinality | \`user_agent\`, \`trace_id\` |
| \`ngrambf_v1(n, size, hashes, seed)\` | LIKE / substring search on strings | \`query_text\`, \`url_path\` |

\`\`\`sql
-- minmax on a numeric column
ALTER TABLE db.t ADD INDEX idx_code error_code TYPE minmax GRANULARITY 4;

-- bloom filter for string equality
ALTER TABLE db.t ADD INDEX idx_trace trace_id TYPE bloom_filter(0.01) GRANULARITY 1;

MATERIALIZE INDEX idx_trace IN PARTITION ID 'all';
\`\`\`

Skip indexes only help when they skip whole granules (8192 rows). They are useless on columns with near-random values per granule. Verify with \`EXPLAIN indexes = 1 SELECT ...\`.

---

## Projections and Materialized Views

**Projections** — embedded alternative sort orders stored inside the table. Use when you have a second common query shape with a different leading ORDER BY column:

\`\`\`sql
ALTER TABLE db.t ADD PROJECTION proj_by_user (
    SELECT * ORDER BY user_id, event_date
);
ALTER TABLE db.t MATERIALIZE PROJECTION proj_by_user;
\`\`\`

Projections double storage for covered columns. Only add if the query pattern is frequent enough to justify the write amplification.

**Materialized views** — pre-aggregate or transform data into a separate table at insert time. Use for:
- Pre-computed aggregates queried repeatedly (SUM, COUNT by dimension)
- Different granularity (raw events → hourly rollups)
- Derived columns computed at write time to avoid runtime cost

Prefer projections over MVs when the source schema and the query shape are stable. Prefer MVs when you need a different engine (AggregatingMergeTree), different TTL, or cross-table joins at insert time.

---

## Cross-references

- \`storage-optimization\` — TTL policies, tiered storage, part management, codec benchmarking workflow
- \`query-tuning-advisor\` — EXPLAIN output, PREWHERE, JOIN ordering, index effectiveness
- \`migration-patterns\` — ALTER TABLE procedures, mutation monitoring, zero-downtime schema changes
- \`hardware-tuning\` — memory limits, merge thread tuning, MergeTree settings that affect schema trade-offs`,
  },
  {
    name: 'migration-patterns',
    description:
      'Schema migrations: ALTER patterns, engine changes, zero-downtime swaps, clickhouse-local offline migrations, and lightweight UPDATE/DELETE strategies.',
    content: `# Migration Patterns

## ALTER TABLE Operations
- Add column: \`ALTER TABLE t ADD COLUMN col Type [DEFAULT expr] [AFTER existing_col]\`
- Drop column: \`ALTER TABLE t DROP COLUMN col\`
- Modify type: \`ALTER TABLE t MODIFY COLUMN col NewType\` (must be compatible)
- Rename: \`ALTER TABLE t RENAME COLUMN old TO new\`
- These are metadata-only operations — instant for most changes

## Engine Changes
- Cannot ALTER engine directly
- Pattern: create new table → insert from old → rename
\`\`\`sql
CREATE TABLE t_new ENGINE = ReplacingMergeTree() ORDER BY id AS SELECT * FROM t_old;
RENAME TABLE t_old TO t_backup, t_new TO t_old;
\`\`\`
- For large tables: use \`INSERT INTO ... SELECT\` with batching

## EXCHANGE TABLES (v22.5+)
- Atomic swap without RENAME chain: \`EXCHANGE TABLES t_old AND t_new\`
- Simpler and safer than \`RENAME TABLE t_old TO t_backup, t_new TO t_old\`
- Both tables must exist and be in the same database

## Zero-Downtime Migrations
1. Create new table with desired schema
2. Create materialized view to capture new inserts: \`CREATE MATERIALIZED VIEW mv TO t_new AS SELECT ... FROM t_old\`
3. Backfill historical data: \`INSERT INTO t_new SELECT ... FROM t_old\`
4. Verify data consistency
5. Switch application to new table
6. Drop old table and materialized view

## Data Backfill Patterns
- Batch by partition: \`INSERT INTO new SELECT * FROM old WHERE toYYYYMM(date) = 202301\`
- Use \`max_insert_block_size\` and \`max_threads\` for throughput control
- Monitor with \`system.processes\` and \`system.merges\`
- Verify row counts match after backfill

## Lightweight Mutations
- \`ALTER TABLE t UPDATE col = expr WHERE condition\` — async by default (\`mutations_sync = 0\`)
- Track progress: \`SELECT * FROM system.mutations WHERE table = 't'\`
- \`ALTER TABLE t DELETE WHERE condition\` — rewrites affected parts
- Throttle impact: set \`max_rows_per_mutation\` to limit rows per mutation batch
- Always schedule heavy mutations off-peak; monitor \`system.mutations\` for completion

## Cross-Server Migration
- Use \`remote()\` table function to copy between servers:
\`\`\`sql
INSERT INTO local_db.t SELECT * FROM remote('source_host:9000', 'db', 't', 'user', 'pass')
\`\`\`
- For large tables, batch by partition or use \`clickhouse-local\` offline approach

## clickhouse-local Offline Migrations
- Run migrations without a running server: \`clickhouse-local --file migration.sql\`
- Useful for schema changes on cold data or CI/CD validation
- Can operate directly on data files: \`clickhouse-local -S 'col1 Type1, col2 Type2' --input-format Native < data.bin\`

## Schema Migration Versioning
- Track applied migrations with a dedicated table:
\`\`\`sql
CREATE TABLE _schema_migrations (name String, applied_at DateTime DEFAULT now()) ENGINE = TinyLog;
\`\`\`
- Insert a row after each successful migration; check before applying
- Integrate with deployment scripts for idempotent migration runs

## Partition Operations
- \`ALTER TABLE t ATTACH PARTITION id FROM other_table\` — zero-copy if same structure
- \`ALTER TABLE t REPLACE PARTITION id FROM other_table\` — atomic swap
- \`ALTER TABLE t MOVE PARTITION id TO TABLE other_table\` — move data

## Common Pitfalls
- Nullable to non-Nullable requires default value for existing NULLs
- Changing ORDER BY requires table recreation
- Mutations (UPDATE/DELETE) rewrite all parts — schedule off-peak
- Test migrations on staging with production data volumes
- \`EXCHANGE TABLES\` fails if either table is replicated with different replica paths`,
  },
  {
    name: 'data-analysis',
    description:
      'Analyze cluster data and metrics using raw SQL recipes against system.query_log and system.parts when no dedicated tool exists.',
    content: `# Data Analysis

Use this skill when dedicated tools (\`get_slow_queries\`, \`get_expensive_queries\`,
etc.) don't cover the specific aggregation you need. All recipes below are
**read-only**. Always verify column names against \`system-tables-reference\` before
running — \`system.query_log\` columns vary across ClickHouse versions.

Core filter for finished queries:
\`\`\`sql
WHERE type = 'QueryFinish'
  AND event_time >= now() - INTERVAL 24 HOUR
  AND is_initial_query = 1
\`\`\`
Omit \`is_initial_query = 1\` only when you want internal sub-queries too.

---

## Largest Data Scan Ever

Returns the single query that read the most bytes from disk. Useful for
spotting runaway full-table scans in history.

\`\`\`sql
SELECT
    query_id,
    user,
    event_time,
    formatReadableSize(read_bytes)  AS read_size,
    formatReadableQuantity(read_rows) AS read_rows_fmt,
    query_duration_ms,
    substring(query, 1, 400)        AS query_text
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
ORDER BY read_bytes DESC
LIMIT 1
\`\`\`

For the largest scan **in a time window** add \`AND event_time >= now() - INTERVAL 7 DAY\`.
\`read_bytes\` is the compressed bytes read from storage; \`read_rows\` is the row
count before filtering. Column availability: both present since v21.x.

---

## Most Expensive Queries

Rank finished queries by memory, bytes read, or wall-clock duration. Run one
variant or UNION all three for a combined view.

\`\`\`sql
-- By memory_usage
SELECT
    query_id,
    user,
    event_time,
    query_duration_ms,
    formatReadableSize(memory_usage)  AS memory,
    formatReadableSize(read_bytes)    AS read_size,
    substring(query, 1, 300)          AS query_text
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 24 HOUR
ORDER BY memory_usage DESC
LIMIT 20
\`\`\`

Swap \`ORDER BY memory_usage DESC\` for \`read_bytes DESC\` or
\`query_duration_ms DESC\` to rank by a different cost axis. The
\`get_expensive_queries\` tool covers the common case; use raw SQL when you need
a custom time window or additional columns like \`tables\` or \`ProfileEvents\`.

---

## Query Fingerprint Patterns

Groups parameterized variants of the same logical query using
\`normalized_query_hash\`. Shows which query shapes dominate load.

\`\`\`sql
SELECT
    normalized_query_hash,
    count()                                          AS calls,
    avg(query_duration_ms)                           AS avg_duration_ms,
    quantile(0.95)(query_duration_ms)                AS p95_duration_ms,
    sum(read_bytes)                                  AS total_read_bytes,
    formatReadableSize(sum(read_bytes))              AS total_read_size,
    formatReadableQuantity(sum(read_rows))           AS total_read_rows,
    any(substring(query, 1, 200))                    AS sample_query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 24 HOUR
GROUP BY normalized_query_hash
ORDER BY total_read_bytes DESC
LIMIT 30
\`\`\`

\`normalized_query_hash\` replaces literals with \`?\` placeholders before hashing
so \`SELECT 1\` and \`SELECT 2\` share a hash. Available since v20.6.
\`quantile(0.95)\` requires no extra setup; use \`quantiles(0.5, 0.95, 0.99)\` for
multiple percentiles in one pass.

---

## Query Volume / Activity Over Time

Counts of finished queries bucketed by hour. Useful for spotting traffic spikes
or quiet periods.

\`\`\`sql
SELECT
    toStartOfHour(event_time)                AS hour,
    count()                                  AS queries,
    countIf(exception_code != 0)             AS errors,
    avg(query_duration_ms)                   AS avg_duration_ms,
    formatReadableSize(sum(read_bytes))      AS total_read
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 48 HOUR
GROUP BY hour
ORDER BY hour
\`\`\`

Swap \`toStartOfHour\` for \`toStartOfFifteenMinutes\` or \`toStartOfDay\` to change
granularity. \`exception_code\` is 0 on success; a non-zero value with
\`type = 'QueryFinish'\` means the query completed but reported an error.

---

## Top Tables by Size and Rows

Aggregates \`system.parts\` (active parts only) to rank user tables by compressed
disk usage and row count.

\`\`\`sql
SELECT
    database,
    table,
    formatReadableSize(sum(bytes_on_disk))          AS disk_size,
    formatReadableSize(sum(data_compressed_bytes))  AS compressed,
    formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed,
    round(sum(data_uncompressed_bytes) /
          nullIf(sum(data_compressed_bytes), 0), 2) AS compression_ratio,
    formatReadableQuantity(sum(rows))               AS rows,
    count()                                         AS parts
FROM system.parts
WHERE active = 1
  AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
GROUP BY database, table
ORDER BY sum(bytes_on_disk) DESC
LIMIT 30
\`\`\`

\`bytes_on_disk\` includes index files and marks; \`data_compressed_bytes\` covers
only column data. Filter \`active = 1\` to exclude detached/obsolete parts.
All columns present since v21.x. The \`get_disk_usage\` tool covers per-disk
summaries; this recipe breaks down by table.

---

## Period-over-Period Comparison

Compares query load between two equal-length windows using conditional
aggregation — no subqueries, single scan.

\`\`\`sql
-- Compare last 24h vs previous 24h
SELECT
    normalized_query_hash,
    any(substring(query, 1, 200))                    AS sample_query,

    -- Current window
    countIf(event_time >= now() - INTERVAL 24 HOUR)             AS calls_now,
    avgIf(query_duration_ms, event_time >= now() - INTERVAL 24 HOUR) AS avg_ms_now,
    formatReadableSize(
        sumIf(read_bytes, event_time >= now() - INTERVAL 24 HOUR)
    )                                                            AS read_now,

    -- Previous window
    countIf(event_time < now() - INTERVAL 24 HOUR)              AS calls_prev,
    avgIf(query_duration_ms, event_time < now() - INTERVAL 24 HOUR) AS avg_ms_prev,
    formatReadableSize(
        sumIf(read_bytes, event_time < now() - INTERVAL 24 HOUR)
    )                                                            AS read_prev,

    -- Delta
    round(
        (countIf(event_time >= now() - INTERVAL 24 HOUR) -
         countIf(event_time  < now() - INTERVAL 24 HOUR)) * 100.0 /
        nullIf(countIf(event_time < now() - INTERVAL 24 HOUR), 0),
    1)                                                           AS call_delta_pct
FROM system.query_log
WHERE type = 'QueryFinish'
  AND is_initial_query = 1
  AND event_time >= now() - INTERVAL 48 HOUR
GROUP BY normalized_query_hash
HAVING calls_now > 5 OR calls_prev > 5
ORDER BY abs(call_delta_pct) DESC NULLS LAST
LIMIT 30
\`\`\`

The single \`WHERE event_time >= now() - INTERVAL 48 HOUR\` covers both windows.
\`*If\` aggregates split the data by condition. Adjust the \`INTERVAL\` literals
consistently for wider windows (e.g. \`7 DAY\` / \`14 DAY\`).

---

## Usage Notes

- \`query_log\` is sampled on busy clusters; if \`log_queries_probability < 1\` is
  set, counts will be proportional estimates, not exact totals.
- Column availability varies across versions. If a column reference fails with
  code 47 ("Unknown column"), load \`system-tables-reference\` and check the real
  schema with \`get_table_schema('system.query_log')\`.
- \`memory_usage\` in \`query_log\` reflects peak memory during the query, not
  average. For CPU approximation use
  \`ProfileEvents['OSCPUVirtualTimeMicroseconds']\`.
- \`system.query_log\` is flushed asynchronously; the most recent ~1–2 seconds of
  finished queries may not appear immediately.

## Cross-references

- Load \`system-tables-reference\` for exact column lists and common pitfalls
  before hand-writing SQL.
- Load \`query-optimization\` for EXPLAIN-driven tuning once expensive patterns
  are identified.
- Load \`troubleshooting\` for error-code-driven diagnosis of failed queries
  (\`type = 'ExceptionWhileProcessing'\`).`,
  },
  {
    name: 'system-tables-reference',
    description:
      'Exact column names for the system tables the agent queries most (processes, query_log, parts, merges, mutations, replicas, replication_queue, disks, settings, zookeeper, users/grants, metrics) plus rules for choosing dedicated tools over raw SQL. Load before hand-writing SQL against system tables.',
    content: `# System Tables Reference

Load this skill before writing raw SQL against \`system.*\` tables. It lists the
columns that actually exist so you don't reference hallucinated columns. When a
dedicated tool exists for what you need, call it instead of writing SQL.

## Prefer Dedicated Tools Over Raw SQL

Many questions map to a purpose-built tool. Use it — the SQL is already correct
and version-aware:

| Question | Use this tool, not raw SQL |
|----------|----------------------------|
| What is running now? | \`get_running_queries\` |
| Slowest finished queries? | \`get_slow_queries\` |
| Recent failures/errors? | \`get_failed_queries\` |
| Heaviest queries by memory/bytes/duration? | \`get_expensive_queries\` |
| Active merges? | \`get_merge_status\` |
| Replication health? | \`get_replication_status\` |
| Disk space? | \`get_disk_usage\` |
| Server version/uptime/connections? | \`get_metrics\` |

Only fall back to the \`query\` tool for ad-hoc questions that no dedicated tool
covers. If a dedicated tool returns an error, fix the call (e.g. \`hostId\` is a
number like \`0\`, not a string), do **not** rewrite it as raw SQL.

## system.processes — currently running queries

There is **no \`database\` column** on \`system.processes\`. Selecting it fails with
"Unknown expression identifier \`database\`".

Available columns:
\`query_id\`, \`user\`, \`query\`, \`elapsed\`, \`read_rows\`, \`read_bytes\`,
\`written_rows\`, \`written_bytes\`, \`total_rows_approx\`, \`memory_usage\`,
\`peak_memory_usage\`, \`query_kind\`, \`is_initial_query\`, \`address\`, \`port\`,
\`initial_user\`, \`initial_query_id\`, \`client_name\`, \`thread_ids\`, \`ProfileEvents\`,
\`Settings\`, \`current_database\`.

- Use \`current_database\` (not \`database\`) for the session's database.
- To exclude the monitoring query itself: \`WHERE query NOT LIKE '%processes%'\`.
  Do not invent syntax like \`WHERE is_query SELECT WITHOUT '...'\`.
- \`elapsed\` is seconds (Float64). Display with \`formatReadableTimeDelta(elapsed)\`.

\`\`\`sql
SELECT query_id, user, current_database, elapsed, read_rows, memory_usage,
       substring(query, 1, 200) AS query
FROM system.processes
WHERE query NOT LIKE '%processes%'
ORDER BY elapsed DESC
\`\`\`

## system.query_log — query history

Filter by \`type\` and time. Each query produces a \`QueryStart\` row and a finish
row (\`QueryFinish\` on success, \`ExceptionWhileProcessing\` on error). For
completed queries always filter \`WHERE type = 'QueryFinish'\`, otherwise you
double-count starts.

Key columns: \`query_id\`, \`type\`, \`event_time\`, \`event_date\`, \`query_start_time\`,
\`query_duration_ms\`, \`read_rows\`, \`read_bytes\`, \`result_rows\`, \`memory_usage\`,
\`user\`, \`query\`, \`exception_code\`, \`exception\`, \`normalized_query_hash\`,
\`is_initial_query\`, \`databases\`, \`tables\`, \`columns\`, \`ProfileEvents\`.

- The per-row database/table lists are \`databases\`/\`tables\`/\`columns\` (Array),
  not \`database\`/\`table\`.
- Add \`AND is_initial_query = 1\` to avoid counting internal sub-queries.

## system.parts — table parts

Has \`database\` and \`table\`. Filter \`WHERE active = 1\` for live parts.
Key columns: \`database\`, \`table\`, \`partition\`, \`name\`, \`active\`, \`rows\`,
\`bytes_on_disk\`, \`data_compressed_bytes\`, \`data_uncompressed_bytes\`,
\`marks\`, \`modification_time\`, \`min_time\`, \`max_time\`, \`part_type\`, \`disk_name\`.

Compression ratio: \`data_uncompressed_bytes / data_compressed_bytes\`.

## system.merges — active merges

Columns: \`database\`, \`table\`, \`elapsed\`, \`progress\` (0..1), \`num_parts\`,
\`source_part_names\`, \`result_part_name\`, \`total_size_bytes_compressed\`,
\`rows_read\`, \`rows_written\`, \`memory_usage\`, \`is_mutation\`, \`merge_type\`.

## system.replicas — replication status

One row per replicated table. Columns: \`database\`, \`table\`, \`is_leader\`,
\`is_readonly\`, \`absolute_delay\`, \`queue_size\`, \`inserts_in_queue\`,
\`merges_in_queue\`, \`total_replicas\`, \`active_replicas\`, \`last_queue_update\`,
\`zookeeper_path\`. Healthy = \`absolute_delay = 0\`, \`is_readonly = 0\`,
\`active_replicas = total_replicas\`.

## system.metrics vs system.events vs system.asynchronous_metrics

These three are easy to confuse — they use different column names:

- \`system.metrics\`: instantaneous gauges. Columns \`metric\`, \`value\`,
  \`description\`. e.g. \`Query\`, \`TCPConnection\`, \`MemoryTracking\`.
- \`system.events\`: cumulative counters. Columns \`event\`, \`value\`,
  \`description\` — the name column is \`event\`, **not** \`metric\`.
- \`system.asynchronous_metrics\`: periodically sampled. Columns \`metric\`,
  \`value\`. e.g. \`Uptime\`, \`jemalloc.*\`, disk/CPU samples.

## system.errors — error counters

Columns: \`name\`, \`code\`, \`value\`, \`last_error_time\`, \`last_error_message\`,
\`last_error_trace\`. There is no \`last_update_time\` column.

## system.mutations — ALTER UPDATE/DELETE progress

One row per mutation. Columns: \`database\`, \`table\`, \`mutation_id\`, \`command\`,
\`create_time\`, \`parts_to_do\`, \`parts_to_do_names\`, \`is_done\`,
\`latest_failed_part\`, \`latest_fail_time\`, \`latest_fail_reason\`.

- Stuck mutation = \`is_done = 0\` with a non-empty \`latest_fail_reason\`.
- Prefer the \`get_mutations\` tool. \`parts_to_do > 0\` means still running.

## system.replication_queue — pending replication tasks

Columns: \`database\`, \`table\`, \`type\`, \`create_time\`, \`num_tries\`,
\`last_exception\`, \`last_attempt_time\`, \`num_postponed\`, \`postpone_reason\`,
\`node_name\`, \`is_currently_executing\`. High \`num_tries\` + \`last_exception\`
signals a stuck entry. Prefer the \`get_replication_queue\` tool.

## system.disks — storage devices

Columns: \`name\`, \`path\`, \`free_space\`, \`total_space\`, \`unreserved_space\`,
\`keep_free_space\`, \`type\`. Used % = \`(total_space - free_space) / total_space\`.
Prefer the \`get_disk_usage\` tool.

## system.detached_parts — parts needing attention

Columns: \`database\`, \`table\`, \`partition_id\`, \`name\`, \`disk\`, \`reason\`,
\`bytes_on_disk\`. A non-null \`reason\` (e.g. \`broken\`, \`unexpected\`) flags parts
that won't be merged. Prefer the \`get_detached_parts\` tool.

## system.settings vs system.merge_tree_settings — configuration

- \`system.settings\`: session/server settings. Columns \`name\`, \`value\`,
  \`changed\`, \`default\`, \`description\`, \`type\`, \`readonly\`. Filter \`changed = 1\`
  for non-default values. Prefer the \`get_settings\` tool.
- \`system.merge_tree_settings\`: MergeTree engine settings, same columns. Prefer
  the \`get_mergetree_settings\` tool.

## system.zookeeper / Keeper — coordination

\`system.zookeeper\` is an **optional** table that only exists when ZooKeeper or
ClickHouse Keeper is configured. Querying it **requires a \`path\` filter**, e.g.
\`SELECT name, value, ctime, mtime FROM system.zookeeper WHERE path = '/'\`.
Without \`WHERE path = ...\` it errors. Prefer the \`get_zookeeper_info\` tool. If
the query fails with "Unknown table", Keeper is not configured.

## Users, roles & grants — access control

- \`system.users\`: \`name\`, \`id\`, \`storage\`, \`auth_type\`, \`host_ip\`,
  \`host_names\`, \`default_roles_all\`, \`default_roles_list\`.
- \`system.roles\`: \`name\`, \`id\`, \`storage\`.
- \`system.grants\`: \`user_name\`, \`role_name\`, \`access_type\`, \`database\`,
  \`table\`, \`column\`, \`is_partial_revoke\`, \`grant_option\`.
- \`system.role_grants\`: \`user_name\`, \`role_name\`, \`granted_role_name\`.
- \`currentUser()\` returns the connected user; \`system.session_log\` (optional)
  has login history. Prefer the \`get_users_and_roles\` / \`get_login_attempts\`
  tools.

## system.metric_log & system.asynchronous_metric_log — historical metrics

Time-series snapshots of \`system.metrics\` / \`system.asynchronous_metrics\`.
Columns: \`event_time\`, \`event_date\`, plus one column per metric (wide table) in
\`metric_log\`; \`metric\`, \`value\` in \`asynchronous_metric_log\`. Use for trends
over time rather than instantaneous values.

## system.distributed_ddl_queue — ON CLUSTER operations

Columns: \`entry\`, \`host_name\`, \`query\`, \`status\`, \`cluster\`, \`initiator\`,
\`query_create_time\`, \`query_finish_time\`, \`exception_code\`. \`status = 'Failed'\`
or a non-zero \`exception_code\` flags a failed distributed DDL. Prefer the
\`get_distributed_ddl_queue\` tool.

## Recovery Rules

- Unknown column (code 47) or unknown identifier → load this skill or call
  \`get_table_schema\` for the table, then retry with real column names. Do not
  guess again.
- There is no CPU% column anywhere. Approximate load via \`memory_usage\`,
  \`read_rows\`, \`read_bytes\` on \`system.processes\`, or \`ProfileEvents\` such as
  \`OSCPUVirtualTimeMicroseconds\` in \`system.query_log\`.

## Cross-references
- Load \`query-optimization\` for EXPLAIN, PREWHERE, JOIN tuning.
- Load \`troubleshooting\` for error-code-driven diagnosis.`,
  },
  {
    name: 'storage-optimization',
    description:
      'Compression codecs, TTL policies, tiered storage, part management, and disk space optimization.',
    content: `# Storage Optimization

## Compression Codecs
- Default: LZ4 — fast, moderate compression
- \`ZSTD(level)\` — better compression, slower. Level 1-22 (3 is good default)
- \`Delta\` + ZSTD — excellent for time-series monotonic data
- \`DoubleDelta\` — best for timestamps and counters
- \`Gorilla\` — optimized for floating-point gauge metrics
- \`T64\` — for integer columns with small range
- Per-column: \`ALTER TABLE t MODIFY COLUMN col TYPE UInt32 CODEC(Delta, ZSTD(3))\`
- In-place codec change: \`ALTER TABLE t MODIFY COLUMN col CODEC(Delta, ZSTD(3))\`

## TTL Policies
- Table-level: \`ALTER TABLE t MODIFY TTL event_time + INTERVAL 90 DAY\`
- Column-level: \`ALTER TABLE t MODIFY COLUMN old_col TTL event_time + INTERVAL 30 DAY\`
- Move to volume: \`TTL event_time + INTERVAL 7 DAY TO VOLUME 'cold'\`
- Delete: \`TTL event_time + INTERVAL 365 DAY DELETE\`
- Monitor TTL merges: \`system.merges WHERE is_ttl_merge = 1\`

## Tiered Storage
- Define storage policies in config: hot (SSD) → warm (HDD) → cold (S3)
- \`<storage_configuration>\` in config.xml
- Move rules: \`TTL event_time + INTERVAL 7 DAY TO DISK 'hdd'\`
- Check disk usage: \`system.disks\`
- Check volume usage: \`system.storage_policies\`

## Part Management
- Monitor part count: \`SELECT count() FROM system.parts WHERE active AND database = 'db' AND table = 't'\`
- Too many parts (>300 per partition) = degraded performance
- Detached parts: check \`system.detached_parts\`, clean with \`DROP DETACHED PART\`
- Part size target: 1-10GB per part for optimal performance

## Disk Space Recovery
- \`DROP PARTITION\` for bulk deletion by time
- \`TRUNCATE TABLE\` for full table cleanup
- Check for orphaned data: detached parts, temporary files
- System tables can grow large — set TTL on query_log, trace_log, etc.
- Load the \`troubleshooting\` skill for disk-full recovery procedures.`,
  },
  {
    name: 'clickhouse-best-practices',
    description:
      'Production operational practices: insert batching, async writes, query cache, connection pooling, and recommended settings.',
    content: `# ClickHouse Best Practices

## Insert Best Practices

- Batch 10k-100k rows per insert; max 1-2 inserts/sec per table
- Sub-1k-row inserts cause part proliferation; insert in sorting-key order to reduce merge work
- For bulk loads, tune \`min_insert_block_size_rows\` / \`max_insert_block_size_rows\`

## Async Inserts

- \`SET async_insert = 1; SET wait_for_async_insert = 1;\` (1=durable, 0=fire-and-forget)
- Tune \`async_insert_max_data_size\` (1M) and \`async_insert_busy_timeout_ms\` (10s) for batch window

## Query Cache (v23.5+)

- \`SET allow_experimental_query_cache = 1; SET use_query_cache = 1;\`
- TTL: \`query_cache_ttl\`; share across users: \`query_cache_shared_between_users = 1\`
- Control: \`enable_writes_to_query_cache\`, \`enable_reads_from_query_cache\`

## Connection Pooling

- HTTP: set \`pool_size\`, \`max_queries\`; keep-alive is critical
- TCP: built-in multiplexing; tune \`max_connections\`
- Monitor \`system.metrics\` for \`HTTPConnection\`/\`TCPConnection\` to size pools

## Production Settings

- \`max_threads\` — lower for concurrent loads; \`max_insert_threads\` — raise for parallel inserts
- \`max_execution_time\` / \`max_memory_usage\` — per-query limits
- \`join_algorithm\` — prefer \`grace_hash\` or \`auto\` for large joins
- \`input_format_allow_errors_num\` / \`ratio\` — tolerate parse errors in bulk imports

## Query Patterns

- \`COLUMNS('pattern')\` — regex column selection; \`APPLY func\` transforms matches
- \`clusterAllReplicas('cluster')\` — aggregate across all replicas
- \`FINAL\` — force merge for ReplacingMergeTree; use sparingly (full scan)`,
  },
]

/** Get all available skills metadata (without content) */
export function getSkillsMetadata(): ReadonlyArray<{
  name: string
  description: string
}> {
  return SKILLS.map(({ name, description }) => ({
    name,
    description,
  }))
}

/** Load a skill by name, returns null if not found */
export function loadSkillContent(name: string): Skill | null {
  return SKILLS.find((s) => s.name === name) ?? null
}
