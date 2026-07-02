# 12 — Ingestion Growth Analytics

> Priority: P1 · Effort: M · Risk: LOW · Depends on: none
> Category: Painpoint/feature · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

The owner keeps asking a question the dashboard cannot answer today: **"how much
data got added per day, and which table is growing fastest?"** We have `system.part_log`
surfaced as a raw event timeline (`lib/query-config/system/part-log.ts`,
`routes/(dashboard)/part-log.tsx`) and merge-performance charts (`merges/merge-performance.ts`),
but nothing that rolls inserts up **per day, per table** to show ingestion rate,
top tables by rows/bytes added, or a growth trend. Operators (and the AI agent —
see plans 21/10) have to write these `part_log` aggregations by hand every time.

This is a felt painpoint and a natural, declarative extension of the existing
chart + query-config system. It is also a high-value AI-agent tool later
(cross-link plan 21 advisor-engine and plan 10 ai-agent-ops-first: the same
query-configs become agent-callable "ingestion" tools).

## Goal

Add a new **Ingestion** dashboard page (`/ingestion`) that answers, on any
connected host and cluster-safely, in one screen: **per-day rows and bytes
inserted, broken down by table, with the top tables by average rows/bytes added
per day** — driven entirely by declarative query-configs + factory charts, with
graceful degradation when `system.part_log` is absent.

## Design

### Data source & SQL (system.part_log, event_type = NewPart)

`system.part_log` rows with `event_type = 'NewPart'` are the authoritative
insert-ingestion events: each has `rows` and `size_in_bytes` for a newly written
part, plus `event_time`, `database`, `table`. `event_type` is an Enum8 that
differs across versions, so filter with `toInt8(event_type) = 1` (NewPart) rather
than the string, matching the existing `merge-performance.ts` pattern
(`WHERE toInt8(event_type) = 2 ... toInt8(merge_reason) = 1`). Use the
`merge('system', '^part_log')` table function to fold shard-local `part_log`,
`part_log_1`, … like the merges configs already do; provide the `clusterAllReplicas`
variant only where the merges/`replicas-status.ts` configs already do, to keep
parity and avoid double-counting on non-cluster hosts.

**(a) Per-day inserted rows/bytes per table — the primary table view**
`lib/query-config/ingestion/ingestion-by-table.ts` (name: `ingestion-by-table`):

```sql
SELECT
    toDate(event_time)                                   AS event_date,
    database,
    table                                                AS table_name,
    database || '.' || table                             AS table,

    -- Rows inserted (BackgroundBar triplet: base, readable, pct)
    sum(rows)                                             AS rows_inserted,
    formatReadableQuantity(rows_inserted)                AS readable_rows_inserted,
    round(rows_inserted * 100.0
      / nullIf(max(rows_inserted) OVER (), 0), 2)        AS pct_rows_inserted,

    -- Bytes inserted
    sum(size_in_bytes)                                   AS bytes_inserted,
    formatReadableSize(bytes_inserted)                   AS readable_bytes_inserted,
    round(bytes_inserted * 100.0
      / nullIf(max(bytes_inserted) OVER (), 0), 2)       AS pct_bytes_inserted,

    count()                                              AS parts_written
FROM merge('system', '^part_log')
WHERE toInt8(event_type) = 1                             -- NewPart (Enum-safe)
  AND event_time >= now() - INTERVAL {days: UInt32} DAY
GROUP BY event_date, database, table_name, table
ORDER BY event_date DESC, rows_inserted DESC
```

**(b) "Most / average per day" ranking — top tables**
`lib/query-config/ingestion/ingestion-top-tables.ts` (name: `ingestion-top-tables`):
same source, but aggregate over the window and divide by observed active days so
"avg per day" is honest even for tables that ingest intermittently:

```sql
SELECT
    database || '.' || table                             AS table,
    sum(rows)                                             AS total_rows,
    formatReadableQuantity(total_rows)                   AS readable_total_rows,
    sum(size_in_bytes)                                   AS total_bytes,
    formatReadableSize(total_bytes)                      AS readable_total_bytes,
    countDistinct(toDate(event_time))                    AS active_days,
    round(total_rows  / nullIf(active_days, 0))          AS avg_rows_per_day,
    formatReadableQuantity(avg_rows_per_day)             AS readable_avg_rows_per_day,
    round(total_bytes / nullIf(active_days, 0))          AS avg_bytes_per_day,
    formatReadableSize(avg_bytes_per_day)                AS readable_avg_bytes_per_day,
    round(avg_rows_per_day * 100.0
      / nullIf(max(avg_rows_per_day) OVER (), 0), 2)     AS pct_avg_rows_per_day
FROM merge('system', '^part_log')
WHERE toInt8(event_type) = 1
  AND event_time >= now() - INTERVAL {days: UInt32} DAY
GROUP BY table
ORDER BY avg_rows_per_day DESC
LIMIT {limit: UInt32}
```

**(c) Ingestion trend chart — rows/day over time (all tables stacked)**
`lib/query-config/charts/ingestion-rows-per-day.ts` (used by the factory chart):

```sql
SELECT
    toStartOfDay(event_time)                             AS event_time,
    database || '.' || table                             AS table,
    sum(rows)                                             AS rows_inserted
FROM merge('system', '^part_log')
WHERE toInt8(event_type) = 1
  AND event_time >= now() - INTERVAL {days: UInt32} DAY
GROUP BY event_time, table
ORDER BY event_time ASC
```

A parallel `ingestion-bytes-per-day.ts` swaps `sum(rows)` → `sum(size_in_bytes)`.

### Version-compat & graceful degradation

- All three configs set `optional: true` and `tableCheck: 'system.part_log'`
  (same as `part-log.ts` / `merge-performance.ts`). The existing table-validator
  (`lib/table-validator.ts` + `lib/table-existence-cache.ts`) then renders the
  graceful "table missing" EmptyState instead of crashing on servers where
  `part_log` logging is disabled.
- `event_type`/Enum handled via `toInt8(...) = 1` — no string Enum literal, so it
  is safe across the 23.8→25.x Enum re-orderings. No `since`-gated `VersionedSql`
  array is needed because `rows`, `size_in_bytes`, `event_time`, `database`,
  `table` exist in `part_log` across all supported versions
  (verify against `docs/clickhouse-schemas/tables/part_log.md`; if a column is
  version-variant, switch that config to the `sql: [{ since, sql }]` array form
  per CLAUDE.md "ClickHouse Version Compatibility").

### Declarative chart registration (mirror existing factory usage)

Charts use the factory helpers (`components/charts/factory/index.ts`:
`createAreaChart` / `createBarChart`) that resolve their SQL by `chartName`
through `useChartData`. Add:

- `components/charts/ingestion/ingestion-rows-per-day.tsx` — `createAreaChart({ chartName: 'ingestion-rows-per-day', index: 'event_time', defaultInterval: 'toStartOfDay', ... , areaChartProps: { stack: true, breakdown: 'breakdown', breakdownLabel: 'table', breakdownValue: 'rows_inserted', readable: 'quantity' } })`, mirroring `charts/query/query-count.tsx`.
- `components/charts/ingestion/ingestion-top-tables.tsx` — `createBarChart({ chartName: 'ingestion-top-tables', index: 'table', categories: ['avg_rows_per_day'], ... })`, mirroring `charts/query/query-count-by-user.tsx`.

### Files to add / edit

- ADD `lib/query-config/ingestion/ingestion-by-table.ts`, `ingestion-top-tables.ts`.
- ADD chart query-configs `lib/query-config/charts/ingestion-rows-per-day.ts`, `ingestion-bytes-per-day.ts` (wherever the factory chart-configs are catalogued — follow how `query-count`'s SQL is registered).
- ADD chart components under `components/charts/ingestion/`.
- EDIT `lib/query-config/index.ts` — push the two table configs into the `queries` array (and the declarative catalog if the config source is declarative, matching how `merges` is dual-registered — see `getQueryConfigByName.test.ts` parity test).
- ADD route `routes/(dashboard)/ingestion.tsx` using `<PageLayout queryConfig={ingestionByTableConfig} />` with `relatedCharts: ['ingestion-rows-per-day', 'ingestion-top-tables']` on the config (mirror `merges.tsx`).
- EDIT `menu.ts` — add an **Ingestion** item (icon e.g. `TrendingUpIcon`/`DatabaseIcon`, `section: 'main'`, `permission: { feature: 'operations' }`, `tableCheck: 'system.part_log'`), alongside Merges/Part Log.
- EDIT `docs/content/**` tables/system-tables page to mention the Ingestion view (user-facing).

## Steps

1. Write `ingestion-by-table.ts` config (SQL (a) + BackgroundBar columnFormats for `readable_rows_inserted` / `readable_bytes_inserted`; `optional`+`tableCheck`).
2. Write `ingestion-top-tables.ts` config (SQL (b), `defaultParams: { days: 30, limit: 20 }`).
3. Add the two factory chart query-configs (SQL (c) rows + bytes) and register their SQL where `query-count` registers its own.
4. Add `components/charts/ingestion/ingestion-rows-per-day.tsx` (area) and `ingestion-top-tables.tsx` (bar) via the factories.
5. Register both table configs in `lib/query-config/index.ts` (+ declarative catalog for parity).
6. Add `routes/(dashboard)/ingestion.tsx` + `menu.ts` entry; wire `relatedCharts`.
7. Add the real test (below) + a graceful-degradation assertion (config is `optional` with `tableCheck: 'system.part_log'`).
8. Update docs + the roadmap status row.

## Real test

`lib/query-config/ingestion/ingestion-by-table.test.ts` (Bun test, mirrors
`getQueryConfigByName.test.ts`), **fails today** (config does not exist), passes
after:

```ts
import { describe, expect, test } from 'bun:test'
import { getQueryConfigByName } from '../index'

describe('ingestion-by-table config', () => {
  const cfg = getQueryConfigByName('ingestion-by-table')
  const sql = typeof cfg?.sql === 'string' ? cfg.sql : cfg?.sql?.[0]?.sql ?? ''

  test('is registered', () => expect(cfg?.name).toBe('ingestion-by-table'))
  test('aggregates part_log inserts per day per table', () => {
    expect(sql).toContain('toDate(event_time)')
    expect(sql).toContain("merge('system', '^part_log')")
    expect(sql).toContain('toInt8(event_type) = 1') // NewPart, Enum-safe
    expect(sql).toContain('sum(rows)')
    expect(sql).toContain('sum(size_in_bytes)')
    expect(sql).toContain('GROUP BY')
  })
  test('degrades gracefully when part_log is absent', () => {
    expect(cfg?.optional).toBe(true)
    expect(cfg?.tableCheck).toBe('system.part_log')
  })
})
```

Add a sibling `ingestion-top-tables.test.ts` asserting `avg_rows_per_day` uses
`countDistinct(toDate(event_time))` (the "avg per day" correctness assertion).

## Verification

```
cd apps/dashboard && bun test src/lib/query-config/ingestion/
bun run test:query-config
bun run lint && bun run build
```

## Out of scope / STOP conditions

- No new ingest/collector process — read-only over `system.part_log` only.
- Do NOT approximate ingestion from `system.tables.total_rows` deltas (no history) or `asynchronous_metric_log` — `part_log` NewPart is the source of truth for THIS plan.
- No per-partition drill-down, no forecasting/anomaly (defer to plan 21).
- STOP and split if the cluster (`clusterAllReplicas`) variant balloons scope — ship the single-host `merge('system','^part_log')` version first; add the cluster variant as a follow-up only where merges configs already do.
- Never gate this behind cloud mode (self-hosted-stays-whole).

## Done

- [ ] Both table configs + two chart configs added and registered; charts render on `/ingestion`.
- [ ] `optional`/`tableCheck` graceful path verified against a host without `part_log`.
- [ ] Real tests fail before / pass after; `bun run lint && bun run build` green.
- [ ] `menu.ts` Ingestion entry added; docs page updated (user-facing).
- [ ] Update the status row for **12** in `plans/roadmap/README.md` (→ IN REVIEW/DONE).
- [ ] Cross-link the new configs as agent tools noted in plan 21/10 (follow-up).
