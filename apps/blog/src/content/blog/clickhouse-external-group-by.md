---
title: "5 min of ClickHouse: spill GROUP BY to disk instead of OOMing"
description: "A high-cardinality GROUP BY can blow past max_memory_usage and die with MEMORY_LIMIT_EXCEEDED. Here's the setting that spills it to disk, the cheaper fixes to try first, and the query that proves a spill happened."
date: 2026-07-10
tag: 5 min of ClickHouse
---

Five minutes, one real diagnostic, no fluff. A `GROUP BY` on a high-cardinality key builds an in-memory hash table — one entry per distinct key. On a big enough table that hash table outgrows `max_memory_usage` and the query dies with `MEMORY_LIMIT_EXCEEDED` (code 241) instead of finishing slowly. Today: the safety valve, and the cheaper options.

## The safety valve

`max_bytes_before_external_group_by` sets a per-query memory threshold. Cross it and ClickHouse writes the partial aggregation state to a temp file on disk, frees the memory, and keeps going — merging the spilled chunks at the end.

```sql
SET max_bytes_before_external_group_by = 10000000000; -- 10 GB, e.g. half of max_memory_usage
```

Same pattern covers two siblings — too low causes needless disk I/O, too high risks OOM:

| Setting | Applies to | Guidance |
|---|---|---|
| `max_bytes_before_external_group_by` | `GROUP BY` | Session-level; common start is half of `max_memory_usage`. `0` disables spilling. |
| `max_bytes_before_external_sort` | `ORDER BY` | Same ratio guidance. |
| `max_bytes_before_external_join` | Hash joins | Same ratio, applied to the join's build side. |

Spilling is strictly slower than staying in RAM — treat it as a safety valve, not a substitute for a correct `max_memory_usage`.

## Try these first (cheaper than spilling)

1. **Pre-aggregate.** If the same aggregation runs repeatedly, a materialized view pre-aggregates on insert so each query scans far fewer rows. See [projections vs materialized views](https://docs.chmonitor.dev/guide/guides/projections-vs-materialized-views).
2. **Two-level aggregation.** `group_by_two_level_threshold` / `group_by_two_level_threshold_bytes` split the hash table into buckets that merge in parallel across threads — lower peak memory without touching disk.
3. **Check the scan first.** A `GROUP BY` reading too many rows because of a missing skip index or partition problem always uses more memory than it should — see the [skip indices guide](https://docs.chmonitor.dev/guide/guides/skip-indices-guide).
4. **Raise `max_memory_usage`** if the cluster genuinely has headroom — RAM is usually faster than spilling to disk.

## Diagnose OOM-killed queries

```sql
SELECT
    event_time, query_id, user, exception_code,
    formatReadableSize(memory_usage) AS memory_usage,
    normalizeQuery(query) AS normalized_query
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
  AND type IN ('ExceptionWhileProcessing', 'ExceptionBeforeStart')
  AND (exception_code = 241 OR exception LIKE '%MEMORY_LIMIT_EXCEEDED%')
ORDER BY event_time DESC
LIMIT 50;
```

## Confirm a spill actually happened

```sql
SELECT
    query_id,
    ProfileEvents['ExternalAggregationWrittenRows']     AS spilled_rows,
    ProfileEvents['ExternalAggregationCompressedBytes'] AS spilled_bytes
FROM system.query_log
WHERE query_id = 'your-query-id'
  AND type = 'QueryFinish';
```

Nonzero `spilled_rows` means it spilled; zero means it finished in memory and the threshold wasn't the bottleneck.

## How chmonitor surfaces this

The Health page's **OOM-Killed Queries** check runs the diagnostic query above continuously and alerts when the rate crosses a threshold, with `read_rows`, `memory_usage`, and the query text linked from Expensive Queries. The AI agent's `query-optimization` skill watches for exactly this pattern — high `memory_usage` on an aggregation step.

## Related

- Docs: [External GROUP BY guide](https://docs.chmonitor.dev/guide/guides/external-group-by) — full spill reference
- Docs: [Query optimization pillar](https://docs.chmonitor.dev/guide/guides/clickhouse-query-optimization)
- Live demo: [dash.chmonitor.dev/metrics](https://dash.chmonitor.dev/metrics)
