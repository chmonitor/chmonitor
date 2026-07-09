---
title: "5 min of ClickHouse: PREWHERE vs WHERE — How Granule Skipping Actually Works"
description: "What PREWHERE actually changes about query execution, when ClickHouse's optimizer gets it wrong, and how to verify granule skipping with EXPLAIN."
date: 2026-07-06
tag: 5 min of ClickHouse
---

Fifth in the series. `PREWHERE` looks like a `WHERE` clause with a different
keyword. It isn't — it changes the *order* ClickHouse reads columns off disk,
and getting it right can turn a full scan into a fraction of one.

## What actually happens

MergeTree stores each column in its own set of files, split into granules of
(by default) 8192 rows. A plain `SELECT col_a, col_b FROM t WHERE col_c = x`
reads `col_c` for every granule *and* reads `col_a`/`col_b` for every granule,
then filters. `PREWHERE` splits this into two passes:

1. Read only the `PREWHERE` column(s) for every granule and evaluate the
   filter.
2. For granules that pass, read the remaining `SELECT`-list columns. For
   granules that don't, skip them entirely — no disk read for `col_a` or
   `col_b` on rows that were going to be filtered out anyway.

The win is proportional to how selective the filter is and how wide the
skipped columns are. Filtering a narrow `status` column to skip reading a wide
`body` column is exactly the shape `PREWHERE` was built for.

## ClickHouse usually does this for you

The query optimizer automatically promotes simple, cheap `WHERE` conditions
into an implicit `PREWHERE` when it's confident it's safe — for straightforward
single-table queries with an obviously selective condition, you often don't
need to write `PREWHERE` by hand. It doesn't always get it right: complex
expressions, conditions that reference computed/aliased columns, or queries
where the optimizer can't prove the column is cheap to read in isolation can
all miss the automatic promotion. When in doubt, write it explicitly.

```sql
-- Before: WHERE only, optimizer may or may not promote it
SELECT url, status, body
FROM access_log
WHERE toDate(event_time) = today()
  AND status = 500

-- After: force PREWHERE on the narrow, selective column
SELECT url, status, body
FROM access_log
PREWHERE status = 500
WHERE toDate(event_time) = today()
```

## Verify it's actually skipping granules

Don't take it on faith — `EXPLAIN indexes = 1` shows exactly how many granules
were selected versus how many exist:

```sql
EXPLAIN indexes = 1
SELECT url, status, body
FROM access_log
PREWHERE status = 500
WHERE toDate(event_time) = today()
```

Look for a line like `Granules: 120/9800` in the output. If the numbers are
close (`N ≈ M`), the filter isn't pruning anything — either the column isn't
selective enough, or it isn't aligned with how the table is sorted (see
`ORDER BY` below), and `PREWHERE` alone won't save you.

You can also confirm the effect after the fact from the query log — compare
`read_rows` (or `ProfileEvents['SelectedRows']`) to `result_rows`. A
`read_rows / result_rows` ratio in the hundreds or thousands on a query with a
`PREWHERE` that isn't firing is the signal to go check `EXPLAIN`:

```sql
SELECT
    query_duration_ms,
    read_rows,
    result_rows,
    read_rows / nullIf(result_rows, 0) AS scan_ratio,
    query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query LIKE '%access_log%'
ORDER BY event_time DESC
LIMIT 5
```

## Two rules that matter more than PREWHERE itself

- **Filters on `ORDER BY`-prefix columns prune granules before `PREWHERE` even
  runs.** The primary key sparse index is the first and cheapest filter
  ClickHouse applies. A `PREWHERE` on a column that isn't in the sort key can
  only avoid reading *other* columns — it can't skip granules the primary key
  already couldn't rule out. Align your date/tenant/id range filters with the
  table's `ORDER BY` first; `PREWHERE` is the second lever, not the first.
- **Never combine `PREWHERE` with `FINAL` on a `ReplacingMergeTree`.** `FINAL`
  needs to see every version of a row to pick the winner; filtering with
  `PREWHERE` before that resolution can silently produce wrong results. Use a
  plain `WHERE` (or filter after) when the query also has `FINAL`.

## How chmonitor surfaces this

The [Explain page](https://docs.chmonitor.dev/guide/features/queries) runs
`EXPLAIN` interactively against any query and renders the plan as a tree
instead of a wall of text — the `Granules: N/M` check above is a couple of
clicks, not a separate terminal session. The AI agent's `explain_query` and
`estimate_query_cost` tools do the same check when asked "why is this query
slow?".

## chmonitor does this for you

Ask the AI agent to explain any query and it runs the `EXPLAIN indexes`
check for you, reads the granule-skipping ratio, and tells you whether
`PREWHERE` is actually helping — not just whether it's present in the SQL.

```bash
docker run -d --name chmonitor -p 3000:3000 \
  -e CLICKHOUSE_HOST=https://clickhouse.example.com:8443 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=change-me \
  ghcr.io/chmonitor/chmonitor:latest
```

Or skip setup and try the [live demo](https://dash.chmonitor.dev/?ref=blog).

## Related

- Docs: [Queries feature](https://docs.chmonitor.dev/guide/features/queries) — the Explain page and query monitoring
- Previous in the series: [What ALTER ... DELETE really costs on a billion-row table](/clickhouse-mutation-alter-delete-cost/)
- Next in the series: [Projections vs materialized views — a decision tree](/clickhouse-projections-vs-materialized-views/)
