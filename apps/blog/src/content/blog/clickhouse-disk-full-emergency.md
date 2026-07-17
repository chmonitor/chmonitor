---
title: "ClickHouse disk is full — what to do right now"
description: "The emergency steps when a ClickHouse disk hits capacity: what system.disks tells you, what's safe to delete or move, and what to fix afterward."
date: 2026-07-10
tag: Troubleshooting
---

Inserts are failing, merges have stopped, and `df` (or `system.disks`) confirms it: a disk backing ClickHouse is out of space. This is the reactive version of the [capacity-planning workflow](/clickhouse-capacity-planning-ttl/) — for when the forecast didn't happen, or the trend moved faster than expected.

## Symptoms

- Inserts fail with disk-space errors; background merges stop making progress (see [reading system.merges](/clickhouse-system-merges-merge-storm/) if you're not sure whether merges are the bottleneck).
- `system.disks` shows free space at or near zero on a disk ClickHouse writes to.
- The server may become generally unresponsive if the disk holding logs or metadata (not just table data) is the one that filled.

## Confirm which disk, and how bad

```sql
SELECT
    name,
    path,
    formatReadableSize(free_space) AS free_space,
    formatReadableSize(total_space) AS total_space,
    round(free_space * 100.0 / total_space, 1) AS percent_free,
    formatReadableSize(keep_free_space) AS keep_free_space
FROM system.disks
ORDER BY percent_free ASC
```

`keep_free_space` is the reserved buffer ClickHouse tries to maintain on that disk — if `free_space` is already below it, you're past the point where ClickHouse itself considered this safe. If there are multiple disks (a storage policy with hot/cold tiers, for example), this query tells you which one is actually the problem — don't assume it's the largest or the one you expect.

## Find what's eating the space

Once you know which disk, find the tables actually using it:

```sql
SELECT
    database,
    table,
    formatReadableSize(sum(bytes_on_disk)) AS total_size,
    count() AS part_count
FROM system.parts
WHERE active
GROUP BY database, table
ORDER BY sum(bytes_on_disk) DESC
LIMIT 20
```

Cross-reference against tables you know are safe to shrink — old partitions past their useful retention, a table that was supposed to have a TTL and doesn't, or duplicate/orphaned data from a failed migration.

## Fix, in order of speed vs. risk

1. **Drop old partitions you know are expendable.** `ALTER TABLE db.t DROP PARTITION '...'` is fast and reclaims space immediately — but only do this for data you've already confirmed doesn't need to exist (an established retention policy, a partition you know is a duplicate). This is the fastest real fix, not `OPTIMIZE`, which needs *more* free space to run, not less.
2. **Free space on the volume outside ClickHouse** if there's anything else sharing the disk (old logs, unrelated files) — sometimes the fastest option and doesn't touch table data at all.
3. **Move a table to a different disk/tier**, if the cluster has a multi-disk storage policy configured — `ALTER TABLE db.t MOVE PARTITION ... TO DISK '...'` shifts data off the full disk without deleting anything.
4. **Do not run `OPTIMIZE TABLE ... FINAL`** as an emergency fix here — it needs free space to write the merged result before the old parts are dropped, and can make an already-full disk situation worse.

## After the fire is out

A disk-full emergency is a sign that the underlying trend wasn't tracked, or a needed TTL wasn't there — the actual fix is proactive. Set up the [disk-forecast and TTL-advisor workflow](/clickhouse-capacity-planning-ttl/) so the next time this trend starts, it shows up as a forecast with weeks of runway instead of a live outage.

## How chmonitor surfaces this

The [Disks](https://docs.chmonitor.dev/guide/features) page shows `system.disks` free/used space per disk, refreshed continuously, so a disk crossing a dangerous threshold is visible before it hits zero. The AI agent's `forecast_disk_capacity` tool (see the [capacity planning post](/clickhouse-capacity-planning-ttl/)) is the proactive counterpart — chmonitor surfaces the trend and forecast, but does not delete data or move partitions for you; those `ALTER TABLE` steps above are always a human call.

## Related

- Docs: [Features overview](https://docs.chmonitor.dev/guide/features) — the Disks page.
- [Capacity planning with the disk-forecast and TTL advisor](/clickhouse-capacity-planning-ttl/) — the proactive version of this post.
- [Reading system.merges when merges pile up](/clickhouse-system-merges-merge-storm/) — merges stalling is a common disk-full symptom.

<!--
CLAIM-VERIFICATION CHECKLIST
- [x] system.disks columns (name, path, free_space, total_space, keep_free_space) checked against apps/dashboard/src/lib/query-config/system/disks.ts and declarative/catalog/system/disks.ts.
- [x] system.parts columns (bytes_on_disk, active) checked against clickhouse-too-many-parts.md (already-verified in this repo's own published post) for consistency.
- [x] "OPTIMIZE TABLE FINAL needs free space, don't run it during a disk-full emergency" is a ClickHouse-mechanics claim (merges write new parts before dropping old ones) consistent with the existing merge-storm and too-many-parts posts' framing of OPTIMIZE as expensive/needs headroom.
- [x] chmonitor described as surfacing the Disks page and forecast tool only — no claim that chmonitor drops partitions or moves data itself (all ALTER TABLE steps explicitly framed as human-run).
- [x] Docs cross-link (guide/features) resolves; internal links point at posts created in this same batch.
-->
