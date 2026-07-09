---
title: "5 min of ClickHouse: What ALTER ... DELETE Really Costs on a Billion-Row Table"
description: "Why ALTER TABLE ... DELETE rewrites whole parts instead of removing rows, how to track progress in system.mutations, and cheaper alternatives."
date: 2026-07-04
tag: 5 min of ClickHouse
---

Fourth in the series. `ALTER TABLE ... DELETE` (and `UPDATE`) reads like a
normal SQL statement, but on a MergeTree table it's nothing like a Postgres
`DELETE`. Understanding what it actually does is the difference between a
five-minute cleanup and an hours-long background job that starves your
merges.

## Why it's not a real delete

MergeTree parts are immutable — ClickHouse never edits a row in place. An
`ALTER ... DELETE` (or `UPDATE`) is a **mutation**: ClickHouse rewrites every
part that contains at least one matching row, in the background, part by
part. If your `WHERE` clause matches one row in a 50GB part, ClickHouse
rewrites the *entire 50GB part* to produce a new one without that row. Rows
aren't deleted — parts are replaced.

That's why a mutation on a billion-row table can take hours: the cost scales
with the size of every part that contains a match, not the number of rows
deleted.

## Watch it happen

```sql
SELECT
    database || '.' || table AS table,
    mutation_id,
    command,
    create_time,
    now() - create_time AS elapsed,
    parts_to_do,
    is_done,
    latest_fail_reason
FROM system.mutations
WHERE is_done = 0
ORDER BY create_time DESC
```

- **`parts_to_do`** — parts still queued for rewrite. This only drops when the
  background mutation pool actually processes a part — it competes for the
  same pool as regular merges (see the
  [previous post](/clickhouse-system-merges-merge-storm/) on `system.merges`,
  where `is_mutation = 1` rows are these same mutations in progress).
- **`latest_fail_reason`** — non-empty means the mutation is stuck, not just
  slow. A stuck mutation blocks new merges on the parts it's targeting until
  it's fixed or killed.
- A mutation with `parts_to_do > 0` and `is_done = 0` for well past the size
  of the table's normal merge cycle is worth investigating — check
  `latest_fail_reason` first before assuming it's just large.

## What it costs beyond time

- **Disk space, temporarily doubled.** Every rewritten part exists as both the
  old and new version until the mutation completes and the old part is
  dropped — a mutation on a disk that's already near full can fail with no
  space left, not a mutation error.
- **Merge pool contention.** Mutations run through the same background pool as
  regular merges (`background_pool_size`). A large mutation can starve routine
  merges, which is how a single `DELETE` cleanup turns into the "too many
  parts" problem from [post one](/clickhouse-too-many-parts/).
- **It can't be undone.** Once a mutation completes, the old rows are gone —
  there's no transaction to roll back.

## Cheaper alternatives

- **`DROP PARTITION` / `TRUNCATE`** if you're deleting by a whole partition
  boundary (e.g. "delete everything before 2024") — this drops parts instantly
  instead of rewriting them, and it's the cheapest possible deletion in
  ClickHouse.
- **TTL instead of a one-off DELETE** for recurring cleanup: `ALTER TABLE t
  MODIFY TTL event_time + INTERVAL 90 DAY DELETE` lets ClickHouse expire old
  data as a routine part of merges instead of a big one-time mutation.
- **Lightweight deletes** (`DELETE FROM table WHERE ...`, available on recent
  ClickHouse versions with `system.parts.has_lightweight_delete`) mark rows as
  deleted without an immediate full rewrite — cheaper up front, but the
  physical cleanup still happens later via normal merges.
- **Rebuild via `INSERT ... SELECT` + `RENAME`** for a large, one-time
  cleanup: write the surviving rows to a new table, then swap table names.
  This is often faster than a mutation on a huge table, at the cost of needing
  double the disk space during the rebuild.

## If a mutation is stuck

```sql
KILL MUTATION WHERE mutation_id = '<mutation_id>'
```

Killing it stops further parts from being rewritten, but any parts it already
finished stay rewritten — it's not atomic. Fix the underlying cause (usually a
schema mismatch in the `WHERE`/`SET` expression, or a disk-space issue) before
re-submitting.

## How chmonitor surfaces this

[Mutations](https://docs.chmonitor.dev/guide/features/operations) lists every
pending and completed mutation with `parts_to_do`, `is_done`, and failure
reason, flags mutations stuck past a threshold, and has a one-click kill
action for the stuck ones — the exact query and action above, no SQL required.

## chmonitor does this for you

chmonitor tracks every mutation from submission to completion and flags
stuck ones automatically, so a rewrite job doesn't silently starve your
merges for hours.

```bash
docker run -d --name chmonitor -p 3000:3000 \
  -e CLICKHOUSE_HOST=https://clickhouse.example.com:8443 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=change-me \
  ghcr.io/chmonitor/chmonitor:latest
```

Or skip setup and try the [live demo](https://dash.chmonitor.dev/?ref=blog).

## Related

- Docs: [Operations feature](https://docs.chmonitor.dev/guide/features/operations) — merges, mutations, moves, part log
- Previous in the series: [Reading system.merges — is your cluster in a merge storm?](/clickhouse-system-merges-merge-storm/)
- Next in the series: [PREWHERE vs WHERE — how granule skipping actually works](/clickhouse-prewhere-vs-where/)
