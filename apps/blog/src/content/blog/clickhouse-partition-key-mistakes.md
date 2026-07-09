---
title: "5 min of ClickHouse: Partition Key Mistakes That Quietly Kill Performance"
description: "The most common ClickHouse PARTITION BY mistakes — over-partitioning, using it like an index — and the system.parts query to check yours."
date: 2026-07-09
tag: 5 min of ClickHouse
---

Seventh in the series. `PARTITION BY` is the setting people get wrong most
often because it *looks* like an indexing decision and isn't — it's a data
lifecycle decision. Getting it wrong doesn't throw an error; it just makes
everything slowly worse until you're debugging [too many
parts](/clickhouse-too-many-parts/) or a [merge storm](/clickhouse-system-merges-merge-storm/)
months later.

## What PARTITION BY is actually for

ClickHouse merges parts *within* a partition, never across partitions. A
partition is the unit you `DROP` or move to cold storage wholesale — it exists
for data lifecycle management (expire old months, move a tenant's data to
different storage), not for query speed. Query speed comes from `ORDER BY`
(the primary key / sparse index), not from `PARTITION BY`. Confusing the two
is the root of most partition key mistakes.

## Mistake 1: partitioning like it's an index

```sql
-- Wrong: partitioning by a high-cardinality query filter
PARTITION BY user_id

-- Wrong: partitioning by every dimension you filter on
PARTITION BY (event_date, event_type, region)
```

Partitioning by `user_id` (or any high-cardinality column) creates one
partition per distinct value — potentially millions of them. Every insert
touches exactly one partition, and a table's total part count is roughly
`partitions × parts-per-partition`, so more partitions directly multiplies
part-count pressure across the whole table. Filtering on `user_id` should
happen through `ORDER BY`, with a skip index if needed — not through
`PARTITION BY`.

## Mistake 2: too fine a granularity

```sql
-- Often too fine for high-volume tables
PARTITION BY toYYYYMMDD(event_date)

-- Usually the right default
PARTITION BY toYYYYMM(event_date)
```

Daily partitioning is only worth it when you routinely `DROP` or move
individual days and the table stays under roughly 1,000 active partitions
total. On a high-volume table, daily partitioning multiplies partition count
12x over monthly for no query-speed benefit — merges still can't cross
partition boundaries, so you end up with more, smaller, less-merged parts.

## Check what you actually have

```sql
SELECT count(DISTINCT partition) AS partition_count
FROM system.parts
WHERE active AND database = {database:String} AND table = {table:String}
```

More than a few hundred active partitions on one table is worth a second
look; more than ~1,000 reliably starts degrading insert and merge
performance — each insert only touches one partition, so many partitions
means many small, slowly-merging parts spread thin. Break it down by
partition to see the shape:

```sql
SELECT
    partition,
    count() AS part_count,
    formatReadableQuantity(sum(rows)) AS rows,
    formatReadableSize(sum(bytes_on_disk)) AS size
FROM system.parts
WHERE active AND database = {database:String} AND table = {table:String}
GROUP BY partition
ORDER BY partition DESC
LIMIT 30
```

A healthy shape has roughly consistent row/byte counts per partition. Wildly
uneven partitions (some near-empty, some huge) usually mean the partition
expression doesn't match how data actually arrives — e.g. partitioning by a
column that's mostly one value with a long tail.

## Fixing an existing bad partition key

`PARTITION BY` can't be changed with `ALTER TABLE` on an existing table — it's
fixed at creation. Changing it means creating a new table with the right key
and migrating data:

```sql
CREATE TABLE events_new AS events
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY (tenant_id, event_date, event_type);

INSERT INTO events_new SELECT * FROM events;

RENAME TABLE events TO events_old, events_new TO events;
```

Budget disk space for both tables to exist simultaneously during the
migration, and validate row counts match before dropping `events_old`.

## How chmonitor surfaces this

[Tables Overview](https://docs.chmonitor.dev/guide/features/tables) shows
`parts_count` per table so an over-partitioned table stands out immediately,
and the AI agent's schema-design advisor inspects the actual partition
distribution (the query above) before recommending a coarser key — it never
issues the `ALTER`/`CREATE` for you.

## chmonitor does this for you

chmonitor tracks partition and part counts per table continuously, so a
partition key mistake shows up as a trend on a chart long before it becomes
an incident.

```bash
docker run -d --name chmonitor -p 3000:3000 \
  -e CLICKHOUSE_HOST=https://clickhouse.example.com:8443 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=change-me \
  ghcr.io/chmonitor/chmonitor:latest
```

Or skip setup and try the [live demo](https://dash.chmonitor.dev/?ref=blog).

## Related

- Docs: [Tables feature](https://docs.chmonitor.dev/guide/features/tables) — parts, storage, and per-table breakdowns
- Previous in the series: [Projections vs materialized views — a decision tree](/clickhouse-projections-vs-materialized-views/)
- Next in the series: [Escaping MEMORY_LIMIT_EXCEEDED without buying a bigger box](/clickhouse-memory-limit-exceeded/)
