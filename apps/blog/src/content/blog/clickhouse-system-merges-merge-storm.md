---
title: "5 min of ClickHouse: Reading system.merges — Is Your Cluster in a Merge Storm?"
description: "How to read system.merges to tell a healthy background merge load from a merge storm eating your CPU and I/O."
date: 2026-07-03
tag: 5 min of ClickHouse
---

Third in the series. `system.merges` shows every merge and part-mutation
currently running on a MergeTree table. It's the table to check whenever a
cluster feels slow but no single query looks guilty — background merges
compete for the same CPU and disk I/O as your `SELECT`s.

## The query

```sql
SELECT
    database || '.' || table AS table,
    elapsed,
    round(progress * 100, 1) AS pct_done,
    num_parts,
    formatReadableQuantity(rows_read) AS rows_read,
    formatReadableQuantity(rows_written) AS rows_written,
    formatReadableSize(memory_usage) AS memory_usage,
    is_mutation,
    merge_type,
    merge_algorithm
FROM system.merges
ORDER BY progress DESC
```

Every row is a merge or mutation *in flight right now* — this table only holds
active operations, not history (for history, `system.part_log` with
`event_type = 'MergeParts'` gives you the completed record). An empty result
set just means nothing is merging at this instant, which is normal between
merge cycles on a quiet table.

## Reading the columns

- **`elapsed`** — seconds since this merge started. A merge sitting at high
  `elapsed` with `progress` barely moving is starved, not just big.
- **`num_parts`** — how many source parts are being combined into one. Larger
  values usually mean this merge is clearing a backlog, not routine
  maintenance.
- **`is_mutation`** — `1` means this "merge" is actually an `ALTER ... UPDATE`
  or `ALTER ... DELETE` rewriting parts, not a routine size-based merge. See
  the [next post](/clickhouse-mutation-alter-delete-cost/) for what that
  actually costs.
- **`merge_type`** — `Regular` (normal size-based merge), `TTL_DELETE` /
  `TTL_RECOMPRESS` (TTL-driven), or a projection/mutation variant depending on
  version. TTL merges spiking unexpectedly usually means a TTL policy just
  crossed a large batch of eligible data at once.

## Is it a storm, or just healthy background work?

A "merge storm" is a self-reinforcing pattern: inserts create parts faster
than merges can consolidate them, so the merge pool keeps launching larger and
larger merges to catch up, each one consuming more memory and I/O, further
starving new small merges — this is the mechanism behind
[Too Many Parts](/clickhouse-too-many-parts/). Signs you're in one:

```sql
-- Count of concurrent merges right now
SELECT count() AS active_merges, sum(memory_usage) AS total_merge_memory
FROM system.merges

-- Merge/mutation volume trend over the last two weeks
SELECT toStartOfDay(event_time) AS day,
       countIf(event_type = 'MergeParts') AS merges,
       countIf(event_type = 'MutatePart') AS mutations
FROM system.part_log
WHERE event_time > now() - INTERVAL 14 DAY
GROUP BY day
ORDER BY day
```

If `active_merges` is consistently pinned at (or near) `background_pool_size`
and part counts are still climbing (from the first post's query), the pool
can't keep up — not a transient blip.

## Fix

- **Confirm it's actually I/O- or CPU-bound**, not just busy: check
  `system.asynchronous_metrics` for disk read/write throughput while merges
  are active. A single slow disk under a merge-heavy workload is a common root
  cause on self-hosted deployments.
- **Raise `background_pool_size`** (server-level, restart required) if there's
  genuine CPU/disk headroom — this only helps if the bottleneck is queue depth,
  not raw I/O capacity.
- **Fix the insert pattern upstream** — a merge storm is usually a symptom of
  the same root cause as too-many-parts: too many small inserts. Fixing
  ingestion batch size fixes both.
- **Don't run `OPTIMIZE ... FINAL` during a storm** — it competes for the same
  merge pool and makes an already-starved queue worse.

## How chmonitor surfaces this

[Merges](https://docs.chmonitor.dev/guide/features/operations) shows this
exact table live, auto-refreshing every 30 seconds, with progress bars per
merge and a linked Merge Performance page for the historical `system.part_log`
trend above.

## chmonitor does this for you

chmonitor watches `system.merges` continuously and flags when the active-merge
count sits near the pool ceiling for a sustained period — before it turns into
a rejected insert.

```bash
docker run -d --name chmonitor -p 3000:3000 \
  -e CLICKHOUSE_HOST=https://clickhouse.example.com:8443 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=change-me \
  ghcr.io/chmonitor/chmonitor:latest
```

Or skip setup and try the [live demo](https://dash.chmonitor.dev/?ref=blog).

## Related

- Docs: [Operations feature](https://docs.chmonitor.dev/guide/features/operations) — merges, merge performance, mutations, moves, part log
- Previous in the series: [Finding your 10 slowest queries from system.query_log](/clickhouse-slowest-queries-system-query-log/)
- Next in the series: [What ALTER ... DELETE really costs on a billion-row table](/clickhouse-mutation-alter-delete-cost/)
