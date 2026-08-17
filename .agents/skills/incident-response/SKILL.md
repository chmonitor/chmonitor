---
name: incident-response
description: "Structured triage recipes for common ClickHouse incidents: disk, errors, replication, mutations, cluster health, and slow queries."
---

# Incident Response

Structured, step-by-step recipes for the most common ClickHouse incidents. Each recipe names the exact tool or system table query, what to look for, and the standard remediation. For multi-step incidents, pair with `update_plan` + the **plan-and-verify** skill to track progress and verify each fix before moving to the next step.

---

## 1. Disk Filling Up

**Triggers**: disk usage > 80 %, insert errors mentioning `DB::Exception: Not enough space`, alerts on free bytes.

**Step 1 — Check free space per disk**

Use the `get_disk_usage` tool or query directly:
```sql
SELECT name, path,
       formatReadableSize(free_space) AS free,
       formatReadableSize(total_space) AS total,
       round(100 - free_space * 100.0 / total_space, 1) AS used_pct
FROM system.disks
ORDER BY used_pct DESC
```
Alert threshold: `used_pct > 85`. Note which disk is filling and which storage policy it belongs to.

**Step 2 — Find the biggest tables and parts**

Use `list_tables` (or query `system.parts`) or:
```sql
SELECT database, table,
       formatReadableSize(sum(bytes_on_disk)) AS disk,
       sum(rows) AS rows,
       count() AS parts
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY sum(bytes_on_disk) DESC
LIMIT 20
```
Also look at `system.parts` with high `modification_time` age — old unmerged parts waste space.

**Step 3 — Estimate insert rate and time-to-full**

Use the `forecast_disk_capacity` tool. Manual estimate:
```sql
SELECT toStartOfHour(event_time) AS hour,
       sum(rows) AS rows_inserted,
       formatReadableSize(sum(bytes_written_to_disk)) AS written
FROM system.part_log
WHERE event_type = 'NewPart'
  AND event_time >= now() - INTERVAL 24 HOUR
GROUP BY hour
ORDER BY hour
```
Divide current free bytes by hourly write rate → hours until full.

**Step 4 — Remediation**

- **TTL**: add or tighten `TTL` on high-volume tables (`ALTER TABLE t MODIFY TTL date + INTERVAL 30 DAY`).
- **Drop partitions**: `ALTER TABLE t DROP PARTITION '2024-01'` for old data (irreversible — confirm first).
- **Move to cold tier**: if tiered storage is configured, `ALTER TABLE t MOVE PARTITION '...' TO DISK 'cold'`.
- **DETACH + DROP**: for tables no longer needed.
- After any action, re-run step 1 to confirm free space recovered.

Cross-references: **storage-optimization** (TTL syntax, tiered storage), **plan-and-verify** (track multi-partition drops safely).

---

## 2. High Error Rate

**Triggers**: spike in failed queries, user-facing 500s, alert on `system.errors`.

**Step 1 — Recent errors from system.errors**

```sql
SELECT name, code, value, remote,
       last_error_time, last_error_message
FROM system.errors
WHERE last_error_time >= now() - INTERVAL 1 HOUR
ORDER BY value DESC
LIMIT 20
```
`value` is the cumulative error count since startup; look for codes with recent `last_error_time` and high `value`.

**Step 2 — Failed queries with exceptions**

Use `get_failed_queries` or:
```sql
SELECT exception_code,
       count() AS cnt,
       topK(5)(exception) AS samples,
       topK(5)(query) AS queries
FROM system.query_log
WHERE type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
  AND event_time >= now() - INTERVAL 1 HOUR
GROUP BY exception_code
ORDER BY cnt DESC
```

**Step 3 — Interpret error codes**

| Code | Meaning | Typical fix |
|------|---------|-------------|
| 60 | Table not found | Verify table/database name; check if DROP happened |
| 47 | Unknown column | Use `get_table_schema`; column may have been dropped |
| 241 | Memory limit exceeded | Reduce scope; add `LIMIT`; raise `max_memory_usage` |
| 159 | Timeout | Add time filter; check for table lock (mutations) |
| 252 | Too many parts | Wait for merges; run recipe 4 |
| 285 | Quorum write failed | Check replica availability (recipe 3) |
| 999 | ZooKeeper/Keeper error | Check Keeper health (recipe 3) |

**Step 4 — Check resource pressure**

Use `get_metrics` or:
```sql
SELECT metric, value
FROM system.metrics
WHERE metric IN (
  'Query', 'BackgroundMergesAndMutationsPoolTask',
  'ZooKeeperRequest', 'MemoryTracking'
)
```
Correlate a memory or Keeper spike with the error burst.

**Step 5 — Remediation**

Fix the specific error code (table, column, limit, Keeper). If a single bad query is causing the spike, kill it:
```sql
KILL QUERY WHERE query_id = '...' ASYNC
```

Cross-references: **troubleshooting** (error code details, OOM), **anomaly-detection** (automated spike detection).

---

## 3. Replication Lag / Failover

**Triggers**: replica is behind, reads from replica return stale data, `absolute_delay` alert.

**Step 1 — Check per-table replication lag**

Use `get_replication_status` or query `system.replication_queue` after `get_table_schema`:
```sql
SELECT database, table, replica_name, replica_path,
       is_leader, is_readonly,
       absolute_delay,
       queue_size, inserts_in_queue, merges_in_queue,
       last_queue_update
FROM system.replicas
WHERE absolute_delay > 0 OR queue_size > 0
ORDER BY absolute_delay DESC
```
`absolute_delay > 300` (5 min) is a concern. `is_readonly = 1` means the replica cannot write — usually a Keeper connectivity problem.

**Step 2 — Inspect the replication queue**

```sql
SELECT database, table, type, source_replica,
       parts_to_merge, create_time,
       last_attempt_time, last_exception,
       num_tries
FROM system.replication_queue
WHERE last_exception != ''
ORDER BY num_tries DESC
LIMIT 20
```
Repeated failures with the same `last_exception` point to a stuck task. High `num_tries` means the replica has been retrying for a while.

**Step 3 — Keeper health**

```sql
SELECT *
FROM system.zookeeper
WHERE path = '/clickhouse'
```
Or query `system.zookeeper` with a `path` filter after `get_table_schema`. Look for high `zookeeper_sessions` in `system.metrics` and watch for `ZooKeeperRequest` latency spikes in `system.asynchronous_metrics`.

Also check the distributed DDL queue for stuck operations:
```sql
SELECT *
FROM system.distributed_ddl_queue
WHERE status != 'Finished'
ORDER BY entry_time
```

**Step 4 — Remediation**

- **High lag, queue draining**: wait; lag recovers automatically once the queue drains.
- **is_readonly**: restore Keeper connectivity; then `SYSTEM RESTART REPLICA db.table`.
- **Stuck queue task**: `SYSTEM DROP REPLICA 'bad_host' FROM TABLE db.table` to remove a dead peer, then let the replica re-sync.
- **Detach + reattach**: last resort — `DETACH TABLE`, restore from another replica's data, `ATTACH TABLE`.

Cross-references: **replication-guide** (full recovery playbook, detach/reattach steps, Keeper tuning).

---

## 4. Stuck Mutations / Merges

**Triggers**: `ALTER TABLE ... UPDATE/DELETE` never completes, `parts_to_do` stays non-zero, merge backlog growing.

**Step 1 — Find stuck mutations**

Query `system.mutations` (columns in `system-tables-reference`) or:
```sql
SELECT database, table, mutation_id,
       command, create_time,
       parts_to_do, is_done,
       latest_fail_reason, latest_fail_time
FROM system.mutations
WHERE is_done = 0
ORDER BY create_time
```
`latest_fail_reason != ''` tells you exactly why it is stuck (disk space, missing column, Keeper timeout).

**Step 2 — Find long-running merges**

```sql
SELECT database, table, elapsed,
       formatReadableSize(total_size_bytes_compressed) AS size,
       progress, merge_type,
       partition_id
FROM system.merges
ORDER BY elapsed DESC
LIMIT 10
```
`elapsed > 3600` (1 hour) for a merge is unusual. `progress` not advancing over several minutes means the merge is likely stuck.

**Step 3 — Check the part count**

```sql
SELECT database, table, partition_id,
       count() AS parts
FROM system.parts
WHERE active
GROUP BY database, table, partition_id
HAVING parts > 100
ORDER BY parts DESC
```
Excessive parts (>300 in a partition) cause mutations and merges to slow or hang.

**Step 4 — Remediation**

- **Kill a stuck mutation**: `KILL MUTATION WHERE mutation_id = 'mutation_8.txt'`
- **Kill a stuck merge**: mutations and merges cannot be killed directly; reduce `background_pool_size` load by pausing inserts temporarily.
- **Fix the root cause**: if `latest_fail_reason` mentions disk space, run recipe 1 first.
- **Too many parts**: throttle inserts; increase `max_bytes_to_merge_at_max_space_in_pool` or temporarily `OPTIMIZE TABLE t PARTITION 'part'` during off-peak.
- **Prefer non-mutating patterns**: use `ReplacingMergeTree` + `CollapsingMergeTree` over heavy UPDATE/DELETE mutations.

Cross-references: **troubleshooting** (mutation + merge details), **storage-optimization** (part count management).

---

## 5. Cluster Health Sweep

**Triggers**: routine check-in, "how is the cluster", pre-maintenance review, post-deploy verification.

Run these in order. Each surfaces a different failure class.

**Step 1 — Server uptime and version**

Use `get_metrics` or:
```sql
SELECT version(), uptime(), now()
```
Unexpected recent uptime means a crash restart occurred.

**Step 2 — Disk headroom**

Run step 1 of recipe 1. Flag any disk above 80 %.

**Step 3 — Recent slow queries**

```sql
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
```

**Step 4 — Recent errors**

Use `get_failed_queries` or run step 1 of recipe 2.

**Step 5 — Merge backlog**

```sql
SELECT count() AS active_merges,
       sum(elapsed) AS total_elapsed_s,
       max(elapsed) AS longest_s
FROM system.merges
```
`active_merges > 50` or `longest_s > 600` warrants investigation (recipe 4).

**Step 6 — Replication status**

```sql
SELECT count() AS lagging_tables,
       max(absolute_delay) AS max_delay_s,
       sum(queue_size) AS total_queue
FROM system.replicas
WHERE absolute_delay > 30 OR queue_size > 10
```
Any `lagging_tables > 0` with growing `max_delay_s` → recipe 3.

**Step 7 — Summarize**

Report findings in priority order: disk → replication → merges → errors → slow queries. Use `update_plan` to record findings and track follow-up actions.

Cross-references: **anomaly-detection** (automated sweep), **plan-and-verify** (track remediation steps).

---

## 6. Slow Query Investigation

**Triggers**: a specific query is slow, user reports latency, `query_duration_ms` alert.

**Step 1 — Currently running queries**

Use `get_running_queries` tool or:
```sql
SELECT query_id, user, elapsed,
       read_rows, formatReadableSize(read_bytes) AS read,
       memory_usage,
       query
FROM system.processes
ORDER BY elapsed DESC
```
A query running for minutes is usually either doing a full scan or waiting for a merge/mutation to release a lock.

**Step 2 — Historical slow queries**

```sql
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
```
`marks_selected` high relative to actual result rows → full granule scan, missing primary key filtering.

**Step 3 — Explain the query plan**

Use the `explain_query` tool. Look for:
- `ReadFromMergeTree` with no key condition → full table scan
- `Filter` after `ReadFromMergeTree` instead of before → PREWHERE opportunity
- `PartialSortingTransform` with huge row counts → missing ORDER BY key alignment
- Large `HashJoin` build side → consider `join_algorithm = 'partial_merge'`

**Step 4 — Check table schema and sorting key**

Use `get_table_schema` tool. Verify:
- The WHERE columns are in the primary key (in order).
- The time column is first or second in the key for time-range queries.
- Partition by granularity matches query patterns.

**Step 5 — Remediation**

- Add `PREWHERE` for selective low-cardinality filters applied before reading full columns.
- Add a skipping index (`INDEX idx col TYPE bloom_filter`) for high-cardinality equality lookups.
- Rewrite JOIN to use a smaller build side; filter before joining.
- For aggregate-only queries, consider a materialized view that pre-aggregates.
- Kill the query if it is consuming excessive resources and a fix is ready: `KILL QUERY WHERE query_id = '...' ASYNC`.

Cross-references: **query-tuning-advisor** (index selection, MV design), **plan-and-verify** (test the rewrite safely before production).

---

## General Guidance

- Always **scope the time window first** — narrow `event_time` filters prevent query_log scans from timing out.
- Use `update_plan` to record what you found, what you changed, and what to verify — especially for multi-step incidents.
- After any remediation, **re-run the diagnostic query** from that recipe step to confirm the metric improved.
- For incidents that span multiple categories (e.g., replication lag caused by disk full), resolve in dependency order: disk → Keeper → replication.
- Load the **anomaly-detection** skill to set up proactive alerting so the same incident does not recur silently.
