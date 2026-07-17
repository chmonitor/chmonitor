---
title: "5 min of ClickHouse: fix 'Memory limit (total) exceeded' (it's not one query)"
description: "The server-wide 'Memory limit (total) exceeded' error is tripped by every concurrent query, merge, and cache combined — not one query's budget. Here are the queries that show what's eating RAM."
date: 2026-07-10
tag: 5 min of ClickHouse
---

Five minutes, one real diagnostic, no fluff. `Code: 241. Memory limit (total) exceeded` looks exactly like the per-query [Memory limit (for query) exceeded](/clickhouse-memory-limit-exceeded/), but the `(total)` wording is the whole story: this is the **server-wide** cap (`max_server_memory_usage`, ~90% of RAM by default), tripped by the sum of every concurrent query, merge, mutation, and cache — not one query's own budget. It can fire when no single query looks expensive.

## Why it happens

- **Too many concurrent queries.** Each moderate, but the sum crosses the cap.
- **Oversized caches.** `mark_cache_size` / `uncompressed_cache_size` set too large for the box.
- **Merges and mutations competing** for the same budget — a merge storm or a large `ALTER … UPDATE/DELETE`.
- **Replication buffers** queueing in-flight data on a busy replica.

## Diagnose

```sql
-- Current total memory tracked by the server
SELECT value AS current_memory_bytes, formatReadableSize(value) AS current_memory
FROM system.metrics
WHERE metric = 'MemoryTracking';
```
```sql
-- Trend over the last few hours (sampled periodically)
SELECT event_time, value AS memory_bytes
FROM system.asynchronous_metric_log
WHERE metric = 'MemoryTracking' AND event_time > now() - INTERVAL 6 HOUR
ORDER BY event_time;
```
```sql
-- Everything currently holding memory, heaviest first
SELECT
    query_id, user, elapsed,
    formatReadableSize(memory_usage) AS current_memory,
    query
FROM system.processes
ORDER BY memory_usage DESC
LIMIT 20;
```

Confirm the ceiling: `SELECT * FROM system.server_settings WHERE name = 'max_server_memory_usage'` (24.x+), or check `max_server_memory_usage` / `max_server_memory_usage_to_ram_ratio` in `config.xml` on older versions.

## Fix

- **Limit concurrency** — cap `max_concurrent_queries` and per-user `max_memory_usage_for_user`.
- **Shrink caches** if oversized — they count against the same total.
- **Raise `max_server_memory_usage`** only if the host has spare RAM the default 90% isn't using.
- **Spread load** across more replicas or shards.
- **Address merge/mutation pressure** — see [Merges slower than inserts](https://docs.chmonitor.dev/guide/guides/merges-slower-than-inserts).

**Don't just raise the ceiling.** Without taming runaway concurrency, the Linux OOM killer may take down the whole `clickhouse-server` process — a much worse outage. (Altinity's [Rescuing ClickHouse from the Linux OOM Killer](https://altinity.com/blog/rescuing-clickhouse-from-the-linux-oom-killer) covers the failure mode.)

## How chmonitor surfaces this

The [Metrics](https://docs.chmonitor.dev/guide/features/metrics) page tracks `MemoryTracking` live, and [Health](https://docs.chmonitor.dev/guide/features/health) rolls memory pressure into the at-a-glance status grid so you see it trending up before the server rejects a query.

## Related

- Docs: [Memory limit (for query) exceeded](https://docs.chmonitor.dev/guide/guides/memory-limit-exceeded)
- Docs: [Merges slower than inserts](https://docs.chmonitor.dev/guide/guides/merges-slower-than-inserts)
- Docs: [Metrics](https://docs.chmonitor.dev/guide/features/metrics)
