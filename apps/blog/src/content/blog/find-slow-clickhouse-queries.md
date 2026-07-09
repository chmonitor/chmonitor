---
title: "Finding your slowest ClickHouse queries with system.query_log"
description: "The exact query_duration_ms > 5000 SQL to surface your slowest ClickHouse queries from system.query_log, what each column means, how it changes across versions, and how to watch for the next one without re-running it by hand."
date: 2026-07-10
tag: How-to
---

This is for anyone running ClickHouse who's been asked "why is this query slow?" and doesn't have a saved query for that. By the end you'll have a copy-pasteable `system.query_log` query that finds your slowest recent queries, know which columns actually matter, and know how to keep watching without re-running it every time.

## Prerequisites

- A ClickHouse user with `SELECT` on `system.query_log`.
- `query_log` logging enabled — it's on by default (`log_queries = 1`), but confirm with `SELECT value FROM system.settings WHERE name = 'log_queries'` if you've customized server config.

## Steps

### 1. Run the slow-query SQL

This is the query: every query that finished in the last 24 hours and took longer than 5 seconds, slowest first.

```sql
SELECT
    query_id,
    query_start_time,
    query_duration_ms,
    user,
    replace(substr(query, 1, 500), '\n', ' ') AS query,
    formatReadableQuantity(read_rows) AS read_rows,
    formatReadableSize(read_bytes) AS read_bytes,
    formatReadableSize(memory_usage) AS memory_usage
FROM system.query_log
WHERE type = 'QueryFinish'
    AND query_duration_ms > 5000
    AND event_time > now() - INTERVAL 24 HOUR
    AND is_initial_query = 1
ORDER BY query_duration_ms DESC
LIMIT 10
```

Three things in the `WHERE` clause do the real work:

- **`type = 'QueryFinish'`** — `system.query_log` also logs `QueryStart`, `ExceptionBeforeStart`, and `ExceptionWhileProcessing` rows. Filtering to `QueryFinish` keeps only queries that actually completed; failed queries need a separate query with `type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')`.
- **`query_duration_ms > 5000`** — the 5-second bar. Lower it while hunting for "slow but not catastrophic" queries, raise it when you only care about the worst offenders.
- **`is_initial_query = 1`** — on a distributed table, ClickHouse logs one row for the query you issued and additional rows for the sub-queries it dispatches to other shards. Without this filter you'll see the same logical query counted multiple times.

### 2. Read the columns that matter

| Column | What it tells you |
|---|---|
| `query_duration_ms` | Total wall-clock time, in milliseconds. What you're sorting by. |
| `memory_usage` | Peak memory the query held. The usual suspect behind `MEMORY_LIMIT_EXCEEDED`. |
| `read_rows` / `read_bytes` | How much data was scanned. A slow query with a huge `read_bytes` is usually missing a filter on the primary key or partition column; a slow query with a *small* `read_bytes` points at CPU-bound work (joins, aggregations, functions) instead. |
| `user` | Who ran it — useful for tracking down an ad-hoc query from a BI tool versus a scheduled job. |
| `query` | The SQL itself, truncated to 500 characters so the result set stays readable. |

### 3. Account for version differences

`system.query_log` has grown columns over releases. Two worth knowing if you're scripting against it:

- **`query_cache_usage`** — added in ClickHouse 24.1. On 23.8–23.12, drop it from the `SELECT` list or the query will fail with "Missing columns."
- **`client_agent`** — added in ClickHouse 26.6, useful for telling apart traffic from different client libraries/tools hitting the same user.

Check what you're running with `SELECT version()` before adding either column to a script that has to work across a fleet on mixed versions.

### 4. Know when a query won't show up yet

`system.query_log` is written asynchronously — ClickHouse buffers rows and flushes them on an interval (`query_log.flush_interval_milliseconds` in the server config, 7.5s by default). A query that just finished may not be queryable for a few seconds. If your slow query isn't showing up, that's usually why — not a bug in the query above.

## Verifying it worked

Run the query from Step 1 against your cluster. You should get back up to 10 rows, ordered by `query_duration_ms` descending, each with a truncated `query` you can recognize. If it returns zero rows, either nothing crossed the 5-second bar in the last 24 hours (good news) or `query_duration_ms > 5000` needs lowering to match your workload.

## Watching for the next one without re-running it

The query above is a snapshot — useful, but you'd have to run it again to catch the next slow query. **chmonitor's [Slow Queries](https://dash.chmonitor.dev/slow-queries) page runs this exact diagnostic continuously**: same `type = 'QueryFinish'` filter, same duration threshold (adjustable via a `min_duration_s` preset — 5s/30s/60s — and a time-window preset from 1 hour to 7 days), with rows over 10s highlighted amber and over 60s highlighted red so the worst ones are visible without reading the numbers. Each row expands into memory and I/O detail, and carries one-click actions to open the query in `EXPLAIN`, jump into the data explorer, or view its resource timeline.

For query *shapes* rather than single executions — "which kind of query is expensive overall, not just this one run" — [Slow Query Patterns](https://dash.chmonitor.dev/slow-query-patterns) aggregates `system.query_log` by `normalized_query_hash` with p50/p95/p99 duration, so a query that runs often at 800ms and one that ran once at 30s don't get conflated.

If you'd rather ask than click, chmonitor's AI agent (connected over MCP, see the [AI agent guide](https://docs.chmonitor.dev/guide/ai-agent)) exposes `get_slow_queries` and `list_slow_query_patterns` as tools — ask it "why is my ClickHouse cluster slow right now" and it runs the same diagnostics.

## Related

- Docs: [Queries feature](https://docs.chmonitor.dev/guide/features/queries) — the full query-observability surface (running, history, failed, expensive, slow, thread-level, query metric log) this post's diagnostic is one page of.
- Docs: [Query Insights API](https://docs.chmonitor.dev/guide/features/query-insights) — the REST endpoints behind Slow Query Patterns, if you want the aggregation programmatically.
- Docs: [AI agent](https://docs.chmonitor.dev/guide/ai-agent) — ask a model to run this diagnostic and explain the result instead of reading raw rows.
