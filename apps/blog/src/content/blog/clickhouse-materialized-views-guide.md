---
title: "5 min of ClickHouse: views vs materialized views — when projections are the better choice"
description: "Regular views, materialized views, and projections each solve a different problem. Here's how to decide which one your query pattern actually needs."
date: 2026-08-05
tag: 5 min of ClickHouse
---

Three objects, one question: "I run this query shape a lot — can ClickHouse pre-organize it?" The answer depends on whether you need speed at query time, speed at insert time, or both.

## Regular VIEW

A regular `VIEW` is just a stored SELECT. It runs the query every time you query it.

```sql
CREATE VIEW active_users AS
SELECT user_id, max(event_time) AS last_seen
FROM events
WHERE is_active = 1
GROUP BY user_id;
```

**Cost**: zero storage overhead, zero insert overhead, full query cost every time.
**Use when**: the query is cheap enough to run live, or you want always-fresh results.

## MATERIALIZED VIEW

A materialized view runs the SELECT against the *newly inserted block* and writes the result into a separate target table. The target table is a real table you query with a `-Merge` suffix for aggregate states.

```sql
-- Target table (you create this)
CREATE TABLE events_daily (
    event_date Date,
    event_type String,
    cnt UInt64
) ENGINE = SummingMergeTree
ORDER BY (event_date, event_type);

-- Materialized view
CREATE MATERIALIZED VIEW mv_events_daily
TO events_daily AS
SELECT event_date, event_type, count() AS cnt
FROM events
GROUP BY event_date, event_type;
```

**Cost**: extra write at insert time, extra storage for the target table.
**Use when**: the aggregation is expensive and the source table is appended to frequently.

Query it with the `-Merge` combinator for `AggregatingMergeTree` targets, or directly for `SummingMergeTree`:

```sql
SELECT event_date, event_type, sum(cnt)
FROM events_daily
GROUP BY event_date, event_type;
```

## PROJECTION

A projection is an alternate sort order for the *same table* — a second physical copy stored pre-sorted. The query optimizer picks it automatically when it's a better match than the base ORDER BY.

```sql
ALTER TABLE events
  ADD PROJECTION proj_by_user_day (
      SELECT * ORDER BY user_id, event_date
  );
ALTER TABLE events MATERIALIZE PROJECTION proj_by_user_day;
```

**Cost**: roughly doubles storage for the projected columns; maintained automatically by ClickHouse.
**Use when**: you have a common filter pattern that doesn't match the base ORDER BY.

Verify it's being used:

```sql
EXPLAIN indexes = 1
SELECT user_id, event_date, count()
FROM events
WHERE user_id = 123 AND event_date >= '2026-01-01'
GROUP BY user_id, event_date;
```

The plan will name the projection when it's selected.

## Decision guide

| Scenario | Best choice |
|---|---|
| Query is cheap, always wants fresh data | Regular VIEW |
| Heavy aggregation on an append-only table | MATERIALIZED VIEW |
| Query pattern needs a different sort order than the base table | PROJECTION |
| Pre-aggregated rollups across tables | MATERIALIZED VIEW with JOIN |
| Filter optimization without schema changes | PROJECTION |

## Common MV gotchas

- **Schema changes**: if you `ALTER TABLE` the source, the MV target doesn't auto-update. You must `DROP MATERIALIZED VIEW` and recreate it, or accept stale data.
- **Dependencies**: dropping the target table breaks the MV silently. Check `system.tables` for `materialized_view` engine entries before dropping anything.
- **Ordering**: MV target ORDER BY must match the GROUP BY keys in the MV query for SummingMergeTree to collapse correctly.

## Common projection gotchas

- **Storage cost**: each projection duplicates its columns. Two projections on a wide table = 3x storage for those columns.
- **Merge time**: projections are materialized during merges. Very large projections slow down merges.
- **Partial projections**: you can project a subset of columns to reduce duplication.

## How chmonitor surfaces this

chmonitor's [query advisor](https://docs.chmonitor.dev/guide/ai-agent) can detect when a materialized view would help a slow query pattern, and the [query config system](https://docs.chmonitor.dev/guide/features/queries) surfaces query performance so you can decide whether pre-computation is worth the storage.

## Related

- Docs: [Query Optimization Advisor](https://docs.chmonitor.dev/guide/ai-agent)
- Docs: [Expensive Queries](https://docs.chmonitor.dev/guide/features/queries)
- Previous in the series: [Practical cost optimization](/clickhouse-cost-optimization/)
