---
title: "5 min of ClickHouse: skip indices that actually prune your scans"
description: "ClickHouse secondary indices skip whole granule blocks instead of indexing rows. Here are the four index types, when each fires, and the EXPLAIN query that proves it's working."
date: 2026-07-10
tag: 5 min of ClickHouse
---

Five minutes, one real diagnostic, no fluff. Skip indices are the ClickHouse feature most people add once and assume is helping — and then never check. Today: what each type is for, and how to confirm it actually prunes.

## The mental model

A ClickHouse "secondary index" is not a B-tree. It's a **data-skipping index**: for each block of granules it stores a tiny summary (a min/max range, a set of values, or a bloom filter), and at query time ClickHouse uses that summary to skip entire granule blocks that can't match — without reading the underlying column.

## The four types

| Type | Good for | How it works |
|---|---|---|
| `minmax` | Range queries on numeric/date columns not in `ORDER BY` | Stores min/max per block; skips blocks outside the range |
| `set(N)` | Equality / `IN` on low-cardinality columns | Stores up to `N` distinct values per block; over `N` distinct → reads everything |
| `bloom_filter` | Equality on higher-cardinality strings | Probabilistic membership per block; false positives only |
| `tokenbf_v1` | Substring search (`LIKE '%error%'`) | Tokenized bloom filter over the column text |

```sql
ALTER TABLE events ADD INDEX idx_amount amount TYPE minmax GRANULARITY 4;
ALTER TABLE events ADD INDEX idx_status status TYPE set(100) GRANULARITY 4;
ALTER TABLE events ADD INDEX idx_request_id request_id TYPE bloom_filter GRANULARITY 4;
ALTER TABLE events ADD INDEX idx_message message TYPE tokenbf_v1(4096, 3, 0) GRANULARITY 4;
```

`GRANULARITY N` groups N index granules into one index block — bigger index but coarser skipping. Start at `4`.

**Adding an index does not backfill existing parts.** Run `ALTER TABLE … MATERIALIZE INDEX idx_name` to build it for data already on disk, or wait for the natural merge cycle.

## Verify it fires

Don't trust that it works — prove it:

```sql
EXPLAIN indexes = 1
SELECT count()
FROM events
WHERE request_id = '3f9c1a2e-...';
```

Find your index name in the plan and confirm `Granules: N/M` shows `N` well below `M`. If the index never appears, the query expression doesn't match (index on `amount` but the filter uses `round(amount, 2)`), or the column is already a prefix of `ORDER BY` — in which case the primary key already prunes for free.

## Audit for dead indices

An index with zero compressed bytes was never built, or was built and never touched. Drop the dead weight — every index is maintained on every insert and merge:

```sql
SELECT
    database, table, name, type, expr, granularity,
    formatReadableSize(data_compressed_bytes) AS compressed_size,
    if(data_compressed_bytes = 0, 'dead', 'active') AS status
FROM system.data_skipping_indices
ORDER BY data_compressed_bytes DESC;
```

## How chmonitor surfaces this

The Data Explorer's per-table **Skip Indexes** panel lists every index with type, expression, granularity, and compression ratio — the same `system.data_skipping_indices` data without SQL. The AI agent's `get_optimization_recommendations` proposes specific skip-index DDL (type and expression already chosen) when it profiles a slow query.

## Related

- Docs: [Skip indices guide](https://docs.chmonitor.dev/guide/guides/skip-indices-guide) — the full secondary-index reference
- Docs: [PREWHERE vs WHERE](https://docs.chmonitor.dev/guide/guides/prewhere-vs-where) — filter pushdown that works alongside indices
- Docs: [Query optimization pillar](https://docs.chmonitor.dev/guide/guides/clickhouse-query-optimization) — the six areas that make ClickHouse slow
