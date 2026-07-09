---
title: "5 min of ClickHouse: Diagnosing 'Too Many Parts' from system.parts"
description: "Why ClickHouse throws Too many parts, the exact system.parts query to find the offending table, and how to fix it without guessing."
date: 2026-06-30
tag: 5 min of ClickHouse
---

Five minutes, one real diagnostic query, no fluff. First in the series: the error
almost every ClickHouse operator hits eventually — `Too many parts`. It looks
like an insert failure, but it's actually a merge-throughput problem wearing an
insert's clothes.

## The symptom

Inserts start failing (or slowing to a crawl) with an exception whose message
mentions "too many parts" and that merges can't keep up with inserts. It's not
random — ClickHouse is protecting itself. Every `INSERT` creates at least one
new part, and every `SELECT` has to open and merge-read every active part in
the query's range. Merges run in the background to consolidate small parts into
bigger ones; if inserts create parts faster than the background pool can merge
them, the part count climbs until ClickHouse throttles, then rejects, inserts.

Three MergeTree settings enforce this, in escalating order:

| Setting | Default | What happens |
|---|---|---|
| `parts_to_delay_insert` | 150 | Inserts start sleeping (artificial backpressure) once a partition crosses this many active parts |
| `parts_to_throw_insert` | 3000 | Inserts fail outright with `TOO_MANY_PARTS` |
| `max_parts_in_total` | 100000 | Server-wide ceiling across all partitions of a table |

## Find the offending table

Don't guess which table is causing it — count active parts per table and sort
descending:

```sql
SELECT
    database,
    table,
    count() AS part_count,
    uniqExact(partition) AS partition_count,
    round(part_count / partition_count, 1) AS avg_parts_per_partition,
    formatReadableSize(sum(bytes_on_disk)) AS total_size
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY part_count DESC
LIMIT 20
```

A healthy MergeTree table sits well under 150 active parts per partition most
of the time — background merges keep consolidating small parts into larger
ones. If `avg_parts_per_partition` is climbing toward the 150/3000 thresholds
above, that table is the one to fix.

Then drill into which partition specifically is accumulating parts:

```sql
SELECT
    partition,
    count() AS part_count,
    min(modification_time) AS oldest_part,
    max(modification_time) AS newest_part,
    formatReadableSize(sum(bytes_on_disk)) AS total_size
FROM system.parts
WHERE active AND database = {database:String} AND table = {table:String}
GROUP BY partition
ORDER BY part_count DESC
LIMIT 20
```

## Common causes

**Too many small inserts.** Each `INSERT` statement — even one with a single
row — creates a new part. High-frequency, low-batch-size inserts (a common
mistake when streaming events row-by-row instead of batching) are the single
biggest cause. Batch inserts client-side or through `async_insert` before they
hit the table.

**Merges falling behind.** Check whether merges are actually running and how
fast:

```sql
SELECT count() AS active_merges,
       sum(rows_read) AS rows_being_merged
FROM system.merges
```

If this is consistently near zero while part counts climb, merges aren't
keeping pace — see the [next post in this series](/clickhouse-system-merges-merge-storm/)
for reading `system.merges` in depth. A single overloaded disk, a
`background_pool_size` that's too small for the insert rate, or CPU contention
from other queries can all starve the merge scheduler.

**Partition key too granular.** Daily or hourly partitioning on a high-volume
table multiplies the number of partitions ClickHouse has to track and merge
independently — merges only happen *within* a partition, never across. See
[partition key mistakes that quietly kill performance](/clickhouse-partition-key-mistakes/)
for the full picture.

## Fix

- **Batch inserts.** Aim for inserts in the low thousands to low millions of
  rows, not one row (or one tiny microbatch) at a time. If the ingestion path
  can't batch client-side, turn on `async_insert = 1` with
  `wait_for_async_insert = 1` so ClickHouse batches on the server.
- **Force a merge as a stopgap** — never a fix, but it buys time while the
  ingestion pattern is fixed: `OPTIMIZE TABLE db.t FINAL`. This is expensive
  (it rewrites the whole table/partition) — run off-peak, not as a reflex.
- **Raise the pool size** if disk I/O has headroom:
  `background_pool_size` (server-level, requires restart) controls how many
  background merge/mutation tasks run concurrently. Check current disk
  utilization first via `system.disks` before raising it — a busier merge pool
  on a saturated disk makes things worse, not better.
- **Coarsen the partition key** if partition count itself is the problem (see
  the partition key post above).

## How chmonitor surfaces this

The [Tables](https://docs.chmonitor.dev/guide/features/tables) page's
Tables Overview lists `parts_count` per table with a link straight into the
per-table Part Info view — the same `system.parts` grouping shown above,
without writing SQL. The AI agent's `get_table_parts` tool runs the same
diagnostic on request ("why does `events` have so many parts?").

## chmonitor does this for you

chmonitor runs this diagnostic continuously and flags tables trending toward
the 150/3000 thresholds before they start rejecting inserts — no dashboards to
build by hand.

```bash
docker run -d --name chmonitor -p 3000:3000 \
  -e CLICKHOUSE_HOST=https://clickhouse.example.com:8443 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=change-me \
  ghcr.io/chmonitor/chmonitor:latest
```

Or skip setup and try the [live demo](https://dash.chmonitor.dev/?ref=blog).

## Related

- Docs: [Tables feature](https://docs.chmonitor.dev/guide/features/tables) — parts, replicas, and storage across every database
- Docs: [Troubleshooting guide](https://docs.chmonitor.dev/guide/guides/troubleshooting)
- Next in the series: [Reading system.merges — is your cluster in a merge storm?](/clickhouse-system-merges-merge-storm/)
