---
title: "ClickHouse monitoring: the dashboards every cluster actually needs"
description: "What to monitor in ClickHouse, which system tables power each view, and how chmonitor turns them into a real-time dashboard — from query latency and merges to replication lag and disk pressure."
date: 2026-07-10
tag: Monitoring
---

ClickHouse exposes almost everything you need to operate it through its own `system` tables — but nobody wants to hand-write that SQL at 3am. This is the ClickHouse monitoring map: the five areas that matter, the system tables behind them, and how chmonitor wires them into a dashboard your whole team can read.

## What ClickHouse monitoring covers

Production monitoring isn't one graph; it's a set of views that answer specific questions: are queries slow, are merges piling up, is replication behind, is disk filling, is memory safe. Each view below maps to a system table chmonitor queries on a fixed interval.

## Steps

### 1. Query performance

The heart of ClickHouse monitoring is `system.query_log` (and `system.query_thread_log` for per-thread detail). Watch p95/p99 latency, failed-query rate, and slowest queries:

```sql
SELECT
  quantiles(0.50, 0.95, 0.99)(query_duration_ms) AS p50_95_99,
  countIf(type = 'ExceptionWhileProcessing')      AS errors,
  count()                                          AS queries
FROM system.query_log
WHERE event_time > now() - INTERVAL 1 HOUR
```

chmonitor's Running Queries view shows live queries; the [slowest-queries post](https://blog.chmonitor.dev/clickhouse-slowest-queries-system-query-log/) shows how to rank them.

### 2. Merges and mutations

`system.merges` and `system.mutations` tell you whether background work is keeping up. A growing queue means inserts are outrunning merges — a classic [merge storm](https://blog.chmonitor.dev/clickhouse-system-merges-merge-storm/):

```sql
SELECT
  table,
  count() AS active_merges,
  countIf(is_mutation) AS active_mutations
FROM system.merges
GROUP BY table
```

### 3. Replication and lag

On replicated tables, `system.replication_queue` and `system.replicas` expose lag and queue depth. chmonitor surfaces replication lag per table so a stuck replica doesn't silently drift:

```sql
SELECT
  database,
  table,
  queue_size,
  absolute_delay
FROM system.replicas
WHERE is_readonly OR absolute_delay > 10
```

See the [replication lag deep-dive](https://blog.chmonitor.dev/clickhouse-replication-lag/) for triage.

### 4. Disk and parts pressure

Disk fills fast when parts aren't merging or TTLs aren't firing. `system.disks` and `system.parts` give capacity and part counts:

```sql
SELECT
  name AS disk,
  formatReadableSize(free_space)     AS free,
  formatReadableSize(total_space)    AS total
FROM system.disks
```

If free space drops under a threshold, chmonitor flags it before writes start failing — the same pressure covered in [disk-full emergency](https://blog.chmonitor.dev/clickhouse-disk-full-emergency/).

### 5. Memory and errors

`system.events` and `system.errors` catch OOM and spikes. The [memory limit exceeded](https://blog.chmonitor.dev/clickhouse-memory-limit-exceeded/) and [system errors spike](https://blog.chmonitor.dev/clickhouse-system-errors-spikes/) posts walk the diagnostic queries.

## Why a dashboard, not SQL

Each query above is easy alone and annoying at scale. chmonitor runs them on an interval, keeps history, and renders them as charts — so you see a latency trend, not a single number, and you catch the drift before it becomes an incident. For Kubernetes, see our [ClickHouse monitoring on Kubernetes](https://blog.chmonitor.dev/clickhouse-monitoring-kubernetes/) guide.

## Related

- Guide: [Find slow ClickHouse queries](https://blog.chmonitor.dev/find-slow-clickhouse-queries/)
- Guide: [ClickHouse on Kubernetes](https://blog.chmonitor.dev/clickhouse-monitoring-kubernetes/)
- Docs: [chmonitor features](https://chmonitor.dev/#features)
