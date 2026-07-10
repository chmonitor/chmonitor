---
title: "ClickHouse optimization: the 7 levers that actually move query latency"
description: "A practical ClickHouse optimization checklist — from PREWHERE and skip indexes to parts management and query profiling — with the system-table queries chmonitor runs to find the wins."
date: 2026-07-10
tag: Performance
---

If you run ClickHouse in production, "make it faster" usually means one of a handful of things: scan less, skip more, build fewer parts, or stop the merges from stealing CPU. This guide is the ClickHouse optimization map we use inside chmonitor — every lever comes with a query you can run today to find whether it applies to your cluster.

## Why optimize ClickHouse per-lever

ClickHouse is fast by default, so most slowdowns are structural: a query reading 40 billion rows when 2 billion would do, a table with 50k parts, or a projection that never got built. Optimizing per-lever means measuring first, then changing the one thing that's actually expensive — not rewriting SQL blind.

## Steps

### 1. Find what's slow

Start with `system.query_log` to rank queries by total time spent, not just average:

```sql
SELECT
  query,
  count()                                   AS runs,
  sum(query_duration_ms)                    AS total_ms,
  round(SUM(read_bytes) / 1e9, 2)           AS read_gb,
  round(quantile(0.95)(query_duration_ms), 1) AS p95_ms
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time > now() - INTERVAL 7 DAY
GROUP BY query
ORDER BY total_ms DESC
LIMIT 20
```

The rows at the top of `total_ms` are where optimization pays off — a query run 10k times at 50ms costs more than one run once at 5s.

### 2. PREWHERE before WHERE

When a wide table is filtered on a low-cardinality column, move that predicate to `PREWHERE` so ClickHouse skips uncompressed granules before reading the rest of the row:

```sql
SELECT *
FROM events
PREWHERE user_id = 42
WHERE event_type = 'purchase'
```

The rule of thumb: put the most selective, cheapest-to-evaluate column in `PREWHERE`. chmonitor's advisor flags missing PREWHERE candidates automatically (see [the query advisor post](https://blog.chmonitor.dev/clickhouse-query-optimization-advisor/)).

### 3. Add skip indexes for sparse filters

If you filter on a column that isn't in the primary key, a data-skipping index lets ClickHouse skip whole granules:

```sql
ALTER TABLE events
  ADD INDEX idx_event_type event_type TYPE bloom_filter(0.01) GRANULARITY 4
```

For time-series, `minmax` and `set` indexes are usually cheaper than `bloom_filter`. Measure granule-skipping with `system.data_skipping_indexes`.

### 4. Right-size the primary key

The ORDER BY key decides physical row order. Put the most-filtered, most-range-scanned columns first — but keep it narrow. A 6-column primary key bloats every part. Our [partition-key mistakes post](https://blog.chmonitor.dev/clickhouse-partition-key-mistakes/) covers the common traps.

### 5. Manage parts (avoid Too Many Parts)

Thousands of tiny parts force merges to fight your reads. Batch inserts and raise `min_insert_block_size_rows` so parts stay large:

```sql
SELECT
  table,
  count()                 AS parts,
  sum(rows)              AS rows,
  round(sum(bytes) / 1e9, 2) AS gb
FROM system.parts
WHERE active
GROUP BY table
ORDER BY parts DESC
LIMIT 20
```

If a table shows tens of thousands of parts, you're in [Too Many Parts](https://blog.chmonitor.dev/clickhouse-too-many-parts/) territory.

### 6. Stop merge storms

Background merges saturate disk and CPU when parts arrive faster than they can be combined. Watch `system.merges` and the [merge storm signals](https://blog.chmonitor.dev/clickhouse-system-merges-merge-storm/):

```sql
SELECT
  table,
  count()                          AS active_merges,
  formatReadableSize(sum(bytes))  AS merging_bytes
FROM system.merges
GROUP BY table
```

### 7. Profile before and after

Never trust an estimate. After a change, re-run the slow query and compare `query_duration_ms` and `read_bytes` from `system.query_log`. chmonitor keeps both the baseline and the new run side by side so the win (or the non-win) is obvious.

## Related

- Guide: [The query optimization pillars](https://blog.chmonitor.dev/clickhouse-query-optimization-pillars/)
- Guide: [PREWHERE vs WHERE](https://blog.chmonitor.dev/clickhouse-prewhere-vs-where/)
- Guide: [Skip indexes](https://blog.chmonitor.dev/clickhouse-skip-indices-guide/)
- Docs: [chmonitor overview](https://dash.chmonitor.dev)
