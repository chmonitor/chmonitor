---
title: "5 min of ClickHouse: Escaping MEMORY_LIMIT_EXCEEDED Without Buying a Bigger Box"
description: "Where ClickHouse's memory limits actually apply, how to find which query or setting is hitting them, and the spill-to-disk settings that fix it."
date: 2026-07-10
tag: 5 min of ClickHouse
---

Eighth and last in the launch batch of this series. `MEMORY_LIMIT_EXCEEDED` is
the error that makes people reach for a bigger server first and ask questions
later. Usually the fix is a setting change, not more RAM — the query is
building something in memory that doesn't need to fit in memory at all.

## Where the limits actually live

ClickHouse enforces memory at three levels, and the error message tells you
which one fired:

| Scope | Setting | Typical message hint |
|---|---|---|
| Per query | `max_memory_usage` | "Memory limit (for query) exceeded" |
| Per user (sum of concurrent queries) | `max_memory_usage_for_user` | "Memory limit (for user) exceeded" |
| Whole server | `max_server_memory_usage` / `max_server_memory_usage_to_ram_ratio` | "Memory limit (total) exceeded" |

A per-query limit means one query is the problem. A per-server limit means
either the server is genuinely under-provisioned, or several queries are
individually fine but collectively too much — check concurrency, not just one
query's plan.

## Find the actual offender

```sql
-- Currently running: who's using memory right now
SELECT query_id, user, elapsed,
       formatReadableSize(memory_usage) AS mem,
       formatReadableSize(peak_memory_usage) AS peak_mem,
       substring(query, 1, 150) AS query
FROM system.processes
ORDER BY peak_memory_usage DESC

-- Historical: which finished/failed queries used the most memory
SELECT query_id, user, type, memory_usage,
       formatReadableSize(memory_usage) AS readable_memory,
       substring(query, 1, 150) AS query
FROM system.query_log
WHERE event_time > now() - INTERVAL 24 HOUR
  AND type IN ('QueryFinish', 'ExceptionWhileProcessing')
ORDER BY memory_usage DESC
LIMIT 20
```

If it's the same query shape every time, it's a query problem. If it's many
different queries all landing near the same ceiling only during a specific
window, it's a concurrency/capacity problem — check how many queries were
running at once during that window via `system.query_log`'s `event_time`.

## Why it's usually GROUP BY, ORDER BY, or a JOIN

The three operations that build large in-memory state:

- **`GROUP BY`** on high-cardinality keys builds a hash table of every distinct
  group before it can emit results.
- **`ORDER BY`** without a `LIMIT` (or with a large one) has to hold the full
  sort set in memory.
- **`JOIN`** builds a hash table from the right-hand table — a large right
  table means a large hash table, regardless of how small the left table or
  the final result is.

## Fix it without more RAM

**Spill to disk instead of failing.** These settings let ClickHouse fall back
to disk-based processing once an operation crosses a byte threshold, instead
of erroring:

```sql
SELECT user_id, count(), uniq(session_id)
FROM events
WHERE event_date = today()
GROUP BY user_id
SETTINGS max_bytes_before_external_group_by = 10000000000, -- 10GB
         max_bytes_before_external_sort = 10000000000
```

Set these to roughly half of `max_memory_usage` as a starting point — too low
causes unnecessary disk spilling on queries that would've fit in memory fine;
too high defeats the purpose and you OOM anyway before spilling kicks in.
`max_bytes_before_external_join` does the same for hash joins.

**Reduce what has to be held in memory in the first place:**

- `uniq(x)` / `COUNT(DISTINCT x)` → `uniqHLL12(x)` — approximate cardinality
  at roughly 1% error for a fraction of the memory.
- `quantile(0.95)(x)` → `quantileTDigest(0.95)(x)` — mergeable, streaming
  percentile estimation instead of holding every value.
- Put the smaller table on the right side of a `JOIN` — ClickHouse's default
  hash join builds its in-memory table from the right side.
- Filter before joining or aggregating, not after — reduce the row count going
  into the memory-heavy operation, not the output of it.

**Right-size the settings for the actual hardware** rather than guessing:

```sql
SELECT name, value, changed, default AS default_value
FROM system.settings
WHERE name IN ('max_memory_usage', 'max_memory_usage_for_user',
                'max_server_memory_usage_to_ram_ratio',
                'max_bytes_before_external_group_by')
```

Compare `value` against actual server RAM (`system.asynchronous_metrics`,
`OSMemoryTotal`) — a `max_memory_usage` set far below what the box actually
has is throttling queries that would otherwise succeed.

## What not to do

Don't jump straight to a bigger instance. A query building an unbounded hash
table will eventually exceed *any* memory limit as data grows — spilling to
disk and reducing memory footprint fixes the query at any data volume; more
RAM only buys time.

## How chmonitor surfaces this

[Metrics](https://docs.chmonitor.dev/guide/features/metrics) tracks
memory usage over time alongside ClickHouse profiler events, and
[Expensive Queries](https://docs.chmonitor.dev/guide/features/queries) ranks
by peak memory (`quantile(0.97)(memory_usage)`) so a memory-hungry query
pattern is visible before it errors, not just after.

## chmonitor does this for you

chmonitor tracks memory usage per query and per server continuously and
surfaces the queries closest to their limit — before they turn into a
`MEMORY_LIMIT_EXCEEDED` incident.

```bash
docker run -d --name chmonitor -p 3000:3000 \
  -e CLICKHOUSE_HOST=https://clickhouse.example.com:8443 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=change-me \
  ghcr.io/chmonitor/chmonitor:latest
```

Or skip setup and try the [live demo](https://dash.chmonitor.dev/?ref=blog).
That's all 8 launch posts in the **5 min of ClickHouse** series — back next
week with more.

## Related

- Docs: [Queries feature](https://docs.chmonitor.dev/guide/features/queries) — expensive and slow query ranking
- Docs: [Troubleshooting guide](https://docs.chmonitor.dev/guide/guides/troubleshooting)
- Previous in the series: [Partition key mistakes that quietly kill performance](/clickhouse-partition-key-mistakes/)
- Start from the beginning: [Diagnosing "Too Many Parts" from system.parts](/clickhouse-too-many-parts/)
