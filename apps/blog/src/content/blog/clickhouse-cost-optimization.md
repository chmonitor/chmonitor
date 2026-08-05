---
title: "5 min of ClickHouse: practical cost optimization without changing your schema"
description: "Where ClickHouse actually costs money, how to find the expensive queries from system.query_log, and the TTL and merge-tuning levers that move storage costs."
date: 2026-08-05
tag: 5 min of ClickHouse
---

"Cost optimization" for ClickHouse usually means two things: the compute dollars spent running queries, and the storage dollars spent holding data. The lever for each is different, and the cheapest fix is almost always not what you think.

## Where the cost actually is

| Cost type | Primary driver | Primary lever |
|---|---|---|
| Compute | Large scans, expensive aggregations | Query rewrite, TTL, partition pruning |
| Storage | Retention policy, part count, merge overhead | TTL, merge tuning, compression |
| Memory pressure | GROUP BY / JOIN hash tables | Spill-to-disk settings, approximation functions |

## Find the expensive queries

```sql
-- Top 20 queries by bytes read in the last 24h
SELECT query_id, user,
       formatReadableSize(sum(read_bytes)) AS total_read,
       formatReadableSize(sum(written_bytes)) AS total_written,
       count() AS exec_count,
       round(avg(elapsed), 2) AS avg_elapsed
FROM system.query_log
WHERE event_time > now() - INTERVAL 24 HOUR
  AND type = 'QueryFinish'
GROUP BY query_id, user
ORDER BY sum(read_bytes) DESC
LIMIT 20;
```

`read_bytes` is your cost signal. A query reading 100GB per run is costing you money every time it executes, regardless of how fast it returns.

## TTL: the cheapest storage lever

If you haven't set TTL on your tables, that's where most storage cost lives. Every row stored beyond its useful lifetime is a direct dollar cost.

```sql
-- Check current TTL on a table
SELECT name, value
FROM system.merge_tree_settings
WHERE name = 'ttl';

-- Set a TTL on a table
ALTER TABLE events
  MODIFY TTL event_date + INTERVAL 90 DAY;
```

TTL deletes data at merge time, not immediately — rows disappear when a part covering them is merged. That's fine for cost purposes, but don't rely on TTL for compliance deletes.

## Part size and merge overhead

ClickHouse's merge process is where CPU cost accumulates. Small parts (from frequent small inserts) force frequent merges:

```sql
-- Average part count and size per table
SELECT database, table,
       count() AS part_count,
       round(avg(bytes_on_disk), 2) AS avg_part_bytes,
       formatReadableSize(sum(bytes_on_disk)) AS total_size
FROM system.parts
WHERE active = 1
GROUP BY database, table
ORDER BY part_count DESC;
```

**Target**: part count below ~300 active parts per partition, average part size between 50MB–150MB. If you're at 1000+ small parts, the merge thread is burning CPU you don't need.

## Query patterns that are expensive

Three patterns appear repeatedly in `read_bytes` rankings:

1. **Large scans without partition pruning**: `SELECT * FROM events` on a table with a date column — the WHERE clause is missing.
2. **High-cardinality GROUP BY**: `GROUP BY user_id` on a table with 10M distinct users builds a hash table before emitting anything.
3. **JOINs with the wrong side**: ClickHouse builds the hash table from the right table. Put the smaller table on the right.

```sql
-- Check cardinality before grouping
SELECT uniq(user_id) AS distinct_users,
       count() AS total_rows
FROM events;
```

If `distinct_users` is close to `total_rows`, GROUP BY is doing almost nothing useful — consider whether the aggregation is necessary.

## When to materialize vs query live

Materialized views pre-compute aggregations at insert time. They cost CPU at insert time but save CPU at query time. If a query runs 100x more often than new data arrives, a materialized view pays for itself.

If a query runs once per day against fresh data, materializing it is overhead.

## Monitor cost over time

Track `read_bytes` and `query_time` trends over time — not just spot checks. A query pattern that was cheap at 1M rows/day becomes expensive at 100M rows/day, and the ramp-up is gradual.

```sql
-- Daily query volume
SELECT toDate(event_time) AS day,
       count() AS queries,
       formatReadableSize(sum(read_bytes)) AS total_read,
       round(avg(elapsed), 2) AS avg_elapsed
FROM system.query_log
WHERE event_time > now() - INTERVAL 30 DAY
  AND type = 'QueryFinish'
GROUP BY day ORDER BY day;
```

## How chmonitor surfaces this

[Expensive Queries](https://docs.chmonitor.dev/guide/features/queries) ranks queries by read bytes and execution time, so you can find the actual cost drivers without hand-crafting aggregation queries. [Merge Performance](https://docs.chmonitor.dev/guide/features/parts) shows part counts and merge activity over time, so small-part problems are visible before they burn CPU.

## Related

- Docs: [Expensive Queries](https://docs.chmonitor.dev/guide/features/queries)
- Docs: [Merge Performance](https://docs.chmonitor.dev/guide/features/parts)
- Docs: [Troubleshooting](https://docs.chmonitor.dev/guide/guides/troubleshooting)
- Next in the series: [Views vs materialized views — and when projections are better](/clickhouse-materialized-views-guide/)
