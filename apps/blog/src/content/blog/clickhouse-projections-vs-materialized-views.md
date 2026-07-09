---
title: "5 min of ClickHouse: Projections vs Materialized Views — A Decision Tree"
description: "When to use a ClickHouse projection versus a materialized view for a recurring query pattern, with the DDL for both."
date: 2026-07-07
tag: 5 min of ClickHouse
---

Sixth in the series. Both projections and materialized views exist to answer
the same underlying question — "I run this query shape all the time, can
ClickHouse pre-organize the data so it's fast?" — but they solve it in
different ways, and picking the wrong one costs either storage or
maintenance you didn't need.

## Projections: an alternate sort order, same table

A projection is a second physical copy of (some or all of) a table's columns,
stored pre-sorted by a different `ORDER BY`. When a query's `WHERE`/`ORDER BY`
matches the projection's sort order better than the base table's, the query
optimizer picks the projection automatically — no query rewrite required.

```sql
ALTER TABLE events ADD PROJECTION proj_by_user (
    SELECT * ORDER BY user_id, event_date
);
ALTER TABLE events MATERIALIZE PROJECTION proj_by_user;
```

Verify it's actually being used with `EXPLAIN indexes = 1` — the plan names
the projection when it's selected.

**Trade-off**: a projection duplicates the columns it covers, so it roughly
doubles storage for those columns. It's maintained automatically by
ClickHouse on every insert and merge — you don't write insert logic for it.

## Materialized views: pre-computed, separate table

A materialized view is a trigger: on every insert into the source table, it
runs a `SELECT` against the newly inserted block and writes the result into a
**separate target table** you define. Typically that target uses
`AggregatingMergeTree` or `SummingMergeTree` to keep pre-aggregated rollups
instead of raw rows.

```sql
CREATE TABLE events_daily_agg (
    event_date Date,
    event_type String,
    cnt AggregateFunction(count)
) ENGINE = AggregatingMergeTree
ORDER BY (event_date, event_type);

CREATE MATERIALIZED VIEW mv_events_daily
TO events_daily_agg AS
SELECT event_date, event_type, countState() AS cnt
FROM events
GROUP BY event_date, event_type;
```

**Trade-off**: you own the target schema and query it explicitly (with
`-Merge` combinators for aggregate states, e.g. `countMerge(cnt)`). It can
change the engine, granularity, and even join across tables at insert time —
projections can't do any of that. The cost is real maintenance: schema
changes to the source table don't automatically propagate to the view.

## The decision tree

```
Same columns, same granularity, just a different sort order?
  → Projection.

Need a different engine (Aggregating/SummingMergeTree),
different granularity (raw → hourly rollup),
or a join across tables at insert time?
  → Materialized view.

Is the query pattern frequent enough to justify double storage
or an extra table to maintain?
  → No: leave it as a regular query, optimize the base table instead
    (see the PREWHERE and partition-key posts in this series).
  → Yes: pick from the two branches above.
```

Prefer a projection when the source schema and the query shape are stable —
it's genuinely maintenance-free once created. Reach for a materialized view
when you need a fundamentally different physical representation of the data,
not just a different sort order of the same rows.

## Check what you already have

Both are visible in `system.tables` and `system.parts`:

```sql
-- Materialized views: their target and source relationship
SELECT database, name, engine, as_select
FROM system.tables
WHERE engine = 'MaterializedView'

-- Projections: which base tables have them, and their size
SELECT database, table, name AS projection_name,
       formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.projection_parts
WHERE active
GROUP BY database, table, name
ORDER BY size DESC
```

If `system.projection_parts` shows a projection consuming significant space
that `EXPLAIN` never picks for real queries, it's a maintenance cost with no
payoff — drop it (`ALTER TABLE t DROP PROJECTION proj_name`).

## How chmonitor surfaces this

The AI agent's `recommend_materialized_view` tool inspects a query pattern
(from `system.query_log` or a query you paste) and proposes whether a
projection or a materialized view fits better, with the DDL to review —
recommend-only, it never creates the DDL for you. The
[Data Explorer](https://docs.chmonitor.dev/guide/features/tables) also renders
every materialized view as a graph edge (`TO` relationships) so you can see
the source → target chain instead of reverse-engineering it from
`SHOW CREATE TABLE`.

## chmonitor does this for you

Ask the AI agent "should this be a projection or a materialized view?" for
any recurring query and it inspects the actual schema and query pattern
before recommending — never auto-applies the DDL.

```bash
docker run -d --name chmonitor -p 3000:3000 \
  -e CLICKHOUSE_HOST=https://clickhouse.example.com:8443 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=change-me \
  ghcr.io/chmonitor/chmonitor:latest
```

Or skip setup and try the [live demo](https://dash.chmonitor.dev/?ref=blog).

## Related

- Docs: [AI Agent](https://docs.chmonitor.dev/guide/ai-agent) — the materialized-view designer and other advisor tools
- Docs: [Tables feature](https://docs.chmonitor.dev/guide/features/tables) — the Data Explorer dependency graph
- Previous in the series: [PREWHERE vs WHERE — how granule skipping actually works](/clickhouse-prewhere-vs-where/)
- Next in the series: [Partition key mistakes that quietly kill performance](/clickhouse-partition-key-mistakes/)
