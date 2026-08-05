---
title: "5 min of ClickHouse: what to monitor (and what not to)"
description: "The four things that actually matter in ClickHouse monitoring, what system tables to check, and why a Grafana dashboard is not the goal — visibility is."
date: 2026-08-05
tag: 5 min of ClickHouse
---

ClickHouse has a lot of system tables. If you wire all of them into Grafana, you get a dashboard that shows everything and alerts on nothing. The practical approach is to monitor four things: query performance, merge activity, replication health, and disk/part count. Everything else is context for those four.

## The four things that matter

### 1. Query performance

The system table: `system.query_log`. This is where slow queries, errors, and memory spikes land.

```sql
-- Slower than 1 second in the last hour
SELECT query_id, user, elapsed, read_rows, read_bytes,
       substring(query, 1, 120) AS query
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
  AND type = 'QueryFinish'
  AND elapsed > 1
ORDER BY elapsed DESC
LIMIT 20;
```

What to watch: `elapsed` trending up on the same query shape, or new query shapes appearing in the slow list.

### 2. Merge activity

The system table: `system.merges`. Merges are ClickHouse's background compaction. When they pile up, it means either parts are too small or the server can't keep up.

```sql
SELECT database, table,
       round(progress * 100, 2) AS pct,
       elapsed,
       formatReadableSize(total_size_bytes_compressed) AS total_size
FROM system.merges
ORDER BY elapsed DESC;
```

What to watch: merge count staying above ~3-4 per table for more than a few minutes, or merges with `elapsed` in the hours range.

### 3. Replication health

The system table: `system.replicas`. If a replica falls behind, reads keep working but writes stop on that replica, and data diverges.

```sql
SELECT database, table, replica_name,
       is_leader, is_readonly,
       future_parts, queue_size,
       absolute_delay
FROM system.replicas
WHERE is_readonly = 1 OR queue_size > 10;
```

What to watch: `is_readonly = 1` (replica is not accepting writes) or `queue_size` growing without draining.

### 4. Disk and part count

The system table: `system.parts` and `system.disk_usage`.

```sql
-- Active part count per table
SELECT database, table, count() AS parts,
       formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE active = 1
GROUP BY database, table
ORDER BY parts DESC;

-- Disk space
SELECT name, path, formatReadableSize(total_space) AS total,
       formatReadableSize(free_space) AS free,
       round(free_space / total_space * 100, 1) AS pct_free
FROM system.disks;
```

What to watch: part count above 300-500 per partition (indicates small parts from frequent small inserts), free space dropping below 20%.

## What NOT to alert on

- **CPU usage alone**: ClickHouse is designed to use available CPU. High CPU during merges is expected, not an incident.
- **Memory usage alone**: ClickHouse allocates memory dynamically. Memory trending up during a large query is normal.
- **Every system.errors entry**: some errors are transient (network hiccup to a replica). Alert on spike rate, not individual entries.

## Multi-host monitoring

If you run multiple ClickHouse hosts, you need one dashboard that shows all four categories across all hosts, not a separate tab per host. The mental model is: "is the cluster healthy?" not "is host 3 healthy?"

chmonitor shows all four categories in a single view across every configured host — `system.query_log` and `system.merges` on one page, `system.replicas` and `system.disks` on the Health page, all filtered by host.

## The query_log is your primary data source

Almost every useful signal lives in `system.query_log`. Slow queries, errors, memory usage, read bytes, rows read — it's all there. Before adding any other system table to your monitoring, make sure you're extracting everything you need from `query_log` first.

```sql
-- Daily query volume trend (watch for sudden drops = monitoring gap)
SELECT toDate(event_time) AS day,
       count() AS queries,
       round(avg(elapsed), 2) AS avg_elapsed,
       formatReadableSize(sum(read_bytes)) AS total_read
FROM system.query_log
WHERE event_time > now() - INTERVAL 30 DAY
  AND type = 'QueryFinish'
GROUP BY day ORDER BY day;
```

## How chmonitor surfaces this

chmonitor's [Overview](https://docs.chmonitor.dev/guide/features/overview) page combines query performance, merge activity, replication status, and disk usage in a single dashboard across all hosts. The AI agent can drill into any anomaly with natural language — "show me queries slower than 5s in the last 6 hours" — without hand-crafting aggregation queries.

## Related

- Docs: [Overview feature](https://docs.chmonitor.dev/guide/features/overview)
- Docs: [Queries feature](https://docs.chmonitor.dev/guide/features/queries)
- Docs: [Health page](https://docs.chmonitor.dev/guide/features/health)
- Next in the series: [Materialized views vs projections](/clickhouse-materialized-views-guide/)
