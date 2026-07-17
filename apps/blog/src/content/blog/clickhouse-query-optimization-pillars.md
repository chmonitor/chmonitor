---
title: "The 6 root causes of slow ClickHouse (and the query that rules out each)"
description: "Most ClickHouse slowness traces to one of six things: partition key, granularity, PREWHERE, skip index, projection vs MV, or GROUP BY memory. A diagnostic map with the system-table query to start at."
date: 2026-07-10
tag: How-to
---

This is for anyone who has stared at a slow ClickHouse query and not known whether to touch the partition key, add an index, or just throw RAM at it. The truth: almost every "ClickHouse is slow" problem is one of six things, and there's a cheap order to rule them out. chmonitor runs this whole diagnosis automatically — this is the map so you understand it.

## The six areas

1. **Partition key** — a bad `PARTITION BY` (high cardinality) causes a too-many-parts spiral.
2. **Partition granularity** — fine vs coarse trade-offs; size partitions correctly.
3. **PREWHERE vs WHERE** — column-level filter pushdown that cuts I/O.
4. **Projections vs materialized views** — which acceleration mechanism fits the query shape.
5. **Skip indices** — minmax / set / bloom_filter / tokenbf_v1, and how to confirm one fires.
6. **External GROUP BY** — spill aggregation to disk instead of `MEMORY_LIMIT_EXCEEDED`.

## Start at the top — part and partition health

A bad partition key or wrong granularity causes symptoms everywhere else. Rule it out first:

```sql
SELECT
    database, table,
    count() AS active_parts,
    uniqExact(partition) AS partitions,
    formatReadableSize(sum(data_compressed_bytes)) AS compressed_size
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY active_parts DESC
LIMIT 20;
```

More than a few hundred active parts on one table, or fewer than ~10 MB compressed per part, is a partitioning problem. See the [partition key best practices](https://docs.chmonitor.dev/guide/guides/partition-key-best-practices) and [granularity](https://docs.chmonitor.dev/guide/guides/partition-granularity) guides.

## Then: is the filter doing its job?

For a specific slow query, run `EXPLAIN indexes = 1 <query>` and compare `Granules: N/M`. If `N` ≈ `M`, the query scans almost everything — the filter isn't pruning. That's a [PREWHERE](https://docs.chmonitor.dev/guide/guides/prewhere-vs-where) or [skip index](https://docs.chmonitor.dev/guide/guides/skip-indices-guide) problem.

## Then: how to accelerate the repeated shape

If the same `GROUP BY`/`WHERE` shape runs often, decide between a [projection or a materialized view](https://docs.chmonitor.dev/guide/guides/projections-vs-materialized-views) to pre-compute it instead of re-scanning raw data.

## Only then: tune memory

If the query genuinely needs to scan a lot (a high-cardinality aggregation), see [external GROUP BY](https://docs.chmonitor.dev/guide/guides/external-group-by) for spill settings — but only after the steps above, since fixing the index or partition is usually cheaper than spilling to disk.

## How chmonitor surfaces this

Ask the AI agent "why is my ClickHouse cluster slow?" and it works through `list_slow_query_patterns` → `explain_query` → `get_optimization_recommendations`, then proposes ranked skip-index, projection, partition-key, and `PREWHERE` fixes as DDL you review and run — it never applies anything itself.

## Related

- Docs: [Query optimization pillar](https://docs.chmonitor.dev/guide/guides/clickhouse-query-optimization) — the full map with links to every guide
- Docs: [AI Agent capabilities](https://docs.chmonitor.dev/guide/ai-agent/capabilities) — the diagnose loop and ranked recommendations
- Docs: [Queries](https://docs.chmonitor.dev/guide/features/queries) — live, historical, failed, and slow query pages
