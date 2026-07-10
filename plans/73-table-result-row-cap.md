# Plan 73: Cap table query result sets server-side and light up the existing "Capped" badge

> **Executor instructions**: Follow step by step; run every verification. On a
> STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/lib/api/query-executor.ts "apps/dashboard/src/routes/api/v1/tables/\$name.ts" apps/dashboard/src/components/tables/table-client.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2490

## Why this matters

Many table query configs run `SELECT *` with **no LIMIT** (e.g.
`lib/query-config/tables/detached-parts.ts:10`, `tables/replicas.ts:12`,
`more/asynchronous-metrics.ts:13`, `more/metrics.ts`, `more/settings.ts`,
`more/users.ts`, `more/roles.ts`, `more/backups.ts`, `tables/view-refreshes.ts:26`),
and `executeTableConfig` applies **no row cap**. On a large or damaged cluster
these system tables can return tens of thousands of rows; the Worker serializes
all of it, ships it to the browser, and the data-table paginates **client-side**
— memory and payload scale unbounded with cluster size.

The truncation UI already exists but is dead: `table-client.tsx:118,131` reads
`metadata.resultRowsBeforeCap` / `metadata.resultRowsTruncated`, which nothing
ever sets (grep at the planned-at commit: those identifiers appear ONLY in
`table-client.tsx`).

## Current state

- `apps/dashboard/src/lib/api/query-executor.ts` — `executeTableConfig`
  (around line 150) builds ClickHouse settings for table queries (query-cache
  settings today); this is the single choke point for all `/api/v1/tables/$name`
  queries. Add the cap here.
- `apps/dashboard/src/routes/api/v1/tables/$name.ts` (~line 176) returns
  `result.data ?? []` and metadata; ClickHouse responses carry
  `rows_before_limit_at_least` when applicable.
- `apps/dashboard/src/components/tables/table-client.tsx:115-135` — the badge:

```tsx
typeof metadata.resultRowsBeforeCap === 'number'
  ? tableRowFormatter.format(metadata.resultRowsBeforeCap)
  ...
{metadata.resultRowsTruncated ? ( ... )}
```

- Metadata type: `apps/dashboard/src/lib/api/types.ts` (`ApiResponseMetadata`) —
  check whether the two fields are declared; add them if not.

ClickHouse mechanism: settings `max_result_rows: <N>` +
`result_overflow_mode: 'break'` make the server stop at N rows and report; the
response `statistics`/`rows_before_limit_at_least` lets you detect truncation.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Build   | `cd apps/dashboard && pnpm run build` | exit 0 |
| Tests   | `cd apps/dashboard && bun test src/lib/api src/routes/api/v1/tables` | all pass |
| Query-config tests | `pnpm run test:query-config` (repo root; needs CH container — skip locally if unavailable and note it) | pass |

## Scope

**In scope**: `lib/api/query-executor.ts`, `routes/api/v1/tables/$name.ts`,
`lib/api/types.ts` (metadata fields), a new env knob
`CHM_TABLE_MAX_RESULT_ROWS` (default 10000, documented in
`apps/dashboard/.env.example`), tests.

**Out of scope**: editing individual query-config SQL (follow-up); chart
queries (`executeChartConfig` or equivalent — different shape, different limits);
the data-table pagination component.

## Git workflow

- Branch: `advisor/73-table-result-row-cap`
- Commit: `feat(api): cap table query result rows and surface truncation`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Add the cap in `executeTableConfig`
Read the current settings block (~line 150). Merge in
`max_result_rows: cap, result_overflow_mode: 'break'` where `cap` reads
`CHM_TABLE_MAX_RESULT_ROWS` (default 10000, `0` disables). Respect any
existing per-config settings precedence.
**Verify**: `pnpm run build` exit 0.

### Step 2: Detect truncation and populate metadata
In the tables route (and/or executor return), when the row count equals the cap
and ClickHouse statistics indicate more rows existed
(`rows_before_limit_at_least > data.length`), set
`resultRowsTruncated: true` and `resultRowsBeforeCap: <rows_before_limit_at_least>`
on the response metadata. Declare both fields on `ApiResponseMetadata` if absent.
**Verify**: `rg -n "resultRowsTruncated" apps/dashboard/src` now shows setter + reader.

### Step 3: Tests
Unit-test the truncation-detection helper (pure function over
`{dataLength, cap, rowsBeforeLimit}`) covering: under cap (no flag), exactly at
cap with more rows (flag + count), cap disabled (no flag).
**Verify**: `bun test src/lib/api` all pass.

### Step 4: Manual smoke (optional if no CH available)
Against a dev ClickHouse, set `CHM_TABLE_MAX_RESULT_ROWS=5` and load a table
page with >5 rows; the "Capped" badge should render.

## Done criteria

- [ ] `executeTableConfig` applies the cap (grep `max_result_rows` in query-executor.ts)
- [ ] Truncation metadata is set and typed; badge path no longer dead
- [ ] New tests pass; `pnpm run build` exit 0
- [ ] `.env.example` documents `CHM_TABLE_MAX_RESULT_ROWS`
- [ ] `plans/README.md` updated

## STOP conditions

- `result_overflow_mode: 'break'` conflicts with the query-cache settings
  already applied (older CH versions) — report versions affected instead of
  shipping a cap that errors.
- The metadata shape is produced somewhere that would require touching chart
  routes too — keep to tables; report the coupling.

## Maintenance notes

- Follow-up (deliberately deferred): add explicit `LIMIT`/`ORDER BY` to the
  worst `SELECT *` configs listed above so the DB does less work, not just the
  transport. Keep the cap as the safety net either way.
- Reviewer: check the cap default doesn't break the few intentionally-large
  pages (settings has ~thousands of rows — 10k default chosen to clear it).
