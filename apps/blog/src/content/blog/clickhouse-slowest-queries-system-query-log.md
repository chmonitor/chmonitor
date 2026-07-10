---
title: "5 min of ClickHouse: Finding Your 10 Slowest Queries from system.query_log"
description: "The exact system.query_log query to rank your slowest ClickHouse queries, what each column means, and what to check next."
date: 2026-07-01
tag: 5 min of ClickHouse
---

Second in the series. Every ClickHouse instance already has the answer to "what's
slow?" sitting in `system.query_log` — you just have to ask it the right way. No
APM agent, no extra instrumentation, it's on by default.

**Want the full walkthrough?** This is the 5-minute version — for version
differences and continuous-monitoring options, see [Finding your slowest
ClickHouse queries with system.query_log: a complete walkthrough](/find-slow-clickhouse-queries/).

## Prerequisites

- `system.query_log` enabled (it is by default on all recent ClickHouse
  versions; if disabled, add a `query_log` block to your server config).
- Read access to `system.query_log`.

## The query

```sql
SELECT
    query_id,
    query_start_time,
    query_duration_ms / 1000 AS query_duration_s,
    user,
    read_rows,
    formatReadableQuantity(read_rows) AS readable_read_rows,
    formatReadableSize(read_bytes) AS readable_read_bytes,
    formatReadableSize(memory_usage) AS readable_memory_usage,
    replace(substr(query, 1, 200), '\n', ' ') AS query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query_duration_ms >= 5000
  AND event_time > now() - INTERVAL 24 HOUR
ORDER BY query_duration_ms DESC
LIMIT 10
```

That's the same query chmonitor's Slow Queries page runs, minus the app's
readable-size and background-bar formatting. Swap the `5000` (5 seconds) and
`24 HOUR` window for whatever you're chasing.

## Reading the columns

- **`type = 'QueryFinish'`** — `system.query_log` logs a row per query attempt,
  including ones that started but errored (`ExceptionWhileProcessing`) or that
  are only partial (`QueryStart`, written before the query finishes). Filtering
  to `QueryFinish` gets you completed queries only; check
  `type = 'ExceptionWhileProcessing'` separately for failures.
- **`query_duration_ms`** — wall-clock time from receiving the query to sending
  the final result. This is what a user actually felt.
- **`read_rows` / `read_bytes`** — how much data was scanned, not how much was
  returned. A query returning 10 rows but reading 500M is doing a full scan
  somewhere — see [PREWHERE vs WHERE](/clickhouse-prewhere-vs-where/) for why
  that happens and how to fix it.
- **`memory_usage`** — peak memory the query held. High memory on a query that
  isn't slow yet is an early warning for `MEMORY_LIMIT_EXCEEDED` — see the
  [memory limit post](/clickhouse-memory-limit-exceeded/) later in this series.

## Group by query shape, not query_id

Ten slow *executions* often boil down to one or two slow *query shapes* run
repeatedly with different literals. Group by `normalized_query_hash` to see the
pattern instead of ten near-duplicate rows:

```sql
SELECT
    normalized_query_hash,
    count() AS executions,
    sum(query_duration_ms) / 1000 AS total_duration_s,
    avg(query_duration_ms) / 1000 AS avg_duration_s,
    quantile(0.99)(query_duration_ms) / 1000 AS p99_duration_s,
    replace(substr(argMax(query, query_duration_ms), 1, 200), '\n', ' ') AS sample_query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND event_time > now() - INTERVAL 24 HOUR
GROUP BY normalized_query_hash
ORDER BY total_duration_s DESC
LIMIT 10
```

`total_duration_s` ranks by aggregate cost to the cluster — the query that runs
500 times a day at 200ms each often costs more than the one slow 10-second
report someone runs once. A wide gap between `p99_duration_s` and
`avg_duration_s` on the same shape usually means the plan is fine but is
occasionally starved (lock contention, a cold cache, or resource contention
from a concurrent big query) rather than fundamentally slow.

## What to check next

Once you have the offending query, don't guess — run `EXPLAIN indexes = 1
<query>` and look at `Granules: N/M`. If `N` is close to `M`, the primary key
isn't pruning anything and you're doing a full scan; that's a schema or
`WHERE`-clause problem, not a "ClickHouse is slow" problem.

## How chmonitor surfaces this

[Slow Queries](https://docs.chmonitor.dev/guide/features/queries) runs exactly
this query with a duration/time-window filter, and each row has a one-click
"Explain query" action so you don't have to copy the SQL out to a separate
client. [Expensive Queries](https://docs.chmonitor.dev/guide/features/queries)
does the `normalized_query_hash` grouping above, ranked by total CPU time
across every execution.

## chmonitor does this for you

chmonitor runs this query continuously, ranks results live, and lets the AI
agent explain *why* a specific query is slow — not just that it is.

```bash
docker run -d --name chmonitor -p 3000:3000 \
  -e CLICKHOUSE_HOST=https://clickhouse.example.com:8443 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=change-me \
  ghcr.io/chmonitor/chmonitor:latest
```

Or skip setup and try the [live demo](https://dash.chmonitor.dev/?ref=blog).

## Related

- Docs: [Queries feature](https://docs.chmonitor.dev/guide/features/queries) — running, historical, failed, and expensive queries
- Deep dive: [Finding your slowest ClickHouse queries with system.query_log: a complete walkthrough](/find-slow-clickhouse-queries/) — the same diagnostic, with version differences and continuous-monitoring options.
- Previous in the series: [Diagnosing "Too Many Parts" from system.parts](/clickhouse-too-many-parts/)
- Next in the series: [Reading system.merges — is your cluster in a merge storm?](/clickhouse-system-merges-merge-storm/)
