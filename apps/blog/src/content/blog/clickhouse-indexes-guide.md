---
title: "5 min of ClickHouse: the two kinds of indexes and when each one actually helps"
description: "ClickHouse has primary keys and skip indexes, and they do completely different things. Here's what index_granularity means, and how bloom_filter, tokenbf_v1, and minmax skip indexes actually help your queries."
date: 2026-08-05
tag: 5 min of ClickHouse
---

Most ClickHouse users encounter two things called "indexes": the primary key (which orders data) and skip indexes (which let the engine skip data blocks). They're often confused because they do completely different things. Understanding both is the difference between a table that scans 10GB per query and one that scans 100MB.

## The primary key / sorting key

ClickHouse's primary key is not a uniqueness constraint. It's a **sort order**. Data is stored on disk in the order defined by the primary key, and queries with matching WHERE clauses can skip whole parts.

```sql
CREATE TABLE events (
    event_date Date,
    user_id UInt64,
    event_type String,
    payload String
) ENGINE = MergeTree
ORDER BY (event_date, user_id);
```

The `ORDER BY` above means events are physically stored sorted by date, then by user_id. A query filtering on `event_date = '2026-08-05'` can skip all parts that don't contain that date.

### index_granularity

`index_granularity` (default: 8192) controls how many rows share one primary-key index entry. A lower granularity means a finer index — more index entries, more skip precision, more memory for the index. A higher granularity means fewer entries, less index memory, coarser skipping.

For most workloads, the default is fine. You rarely need to change it.

```sql
-- Check current setting
SELECT name, value, changed
FROM system.merge_tree_settings
WHERE name = 'index_granularity';
```

## Skip indexes (data skipping indices)

Skip indexes are secondary indexes stored alongside each data part. They describe the *range of values* in each granule of rows, so the engine can skip granules that can't match the WHERE clause.

### minmax

The simplest skip index. Stores min/max per column per granule. Only useful for range queries on low-cardinality columns (dates, small enums).

```sql
ALTER TABLE events
  ADD INDEX idx_event_date event_date TYPE minmax GRANULARITY 4;
```

### bloom_filter

The most useful skip index. A probabilistic data structure that answers "might this value be in this granule?" — false positives, no false negatives. Effective on columns used with `=` or `IN`.

```sql
ALTER TABLE events
  ADD INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 4;
```

### tokenbf_v1

A bloom filter over *tokenized* values. Useful for columns where you search with `LIKE '%substring%'` or `match`. Tokenizes the value at index time so substring searches skip non-matching granules.

```sql
ALTER TABLE events
  ADD INDEX idx_payload payload TYPE tokenbf_v1(256, 3, 0) GRANULARITY 4;
```

Parameters: `capacity` (expected distinct tokens), `num_hash_functions` (3–5 typical), `seed`. Higher capacity = more memory per granule.

### set / minmax_sketch

`set` stores the set of distinct values per granule (good for `IN` with small value lists). `minmax_sketch` is a compressed minmax for wide tables.

## When skip indexes help

Skip indexes help when:
- Your WHERE clause filters on a column that is NOT part of the primary key
- The column has low-to-medium cardinality relative to row count
- The query scans many parts that can be skipped

```sql
-- Check if a skip index is being used
EXPLAIN indexes = 1
SELECT count()
FROM events
WHERE user_id = 12345;
```

The plan shows `idx_user_id` if the bloom filter was consulted.

## When they don't help

- The column is already in the primary key — the primary key is a better skip mechanism
- The column is high-cardinality (e.g. UUID) — bloom filters give few true negatives
- The query returns most rows regardless — skipping a few granules doesn't save much

## Adding and removing

```sql
-- Add a skip index
ALTER TABLE events ADD INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 4;

-- Remove it
ALTER TABLE events DROP INDEX idx_user_id;

-- Check existing skip indexes
SELECT name, type, granularity
FROM system.data_skipping_indices
WHERE database = 'my_db';
```

## Practical example

If you often query `events` by `user_id` and `user_id` is not in your primary key:

```sql
-- Current: primary key is (event_date), user_id is buried in payload
-- Query: SELECT ... WHERE user_id = 123 — scans all dates

ALTER TABLE events
  ADD INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 4;
```

After the next merge, new parts carry the bloom filter. Existing parts get it at merge time too. Queries that filter by user_id will skip granules that don't contain that user.

## How chmonitor surfaces this

The [Explorer](https://docs.chmonitor.dev/guide/features/explorer) page surfaces `system.data_skipping_indices` so you can see which tables have skip indexes and which might benefit from one on a frequently filtered column.

## Related

- Docs: [Explorer feature](https://docs.chmonitor.dev/guide/features/explorer)
- Docs: [Troubleshooting](https://docs.chmonitor.dev/guide/guides/troubleshooting)
- Next in the series: [ch-ui — a lightweight ClickHouse dashboard](/ch-ui-quickstart/)
