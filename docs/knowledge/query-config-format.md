---
id: query-config-format
title: QueryConfig Format
type: spec
status: active
updated: 2026-10-22
tags:
  - query-config
  - clickhouse
  - sql
  - background-bar
related:
  - static-site-architecture
  - mcp-server
---

# QueryConfig Format

## Specification

Each data view uses a `QueryConfig` type
(`apps/dashboard/src/types/query-config.ts`) that defines:

- SQL query with parameters
- Column formatting specifications
- Sorting and filtering options
- Actions available for each row
- Optional table validation flags

### Versioned SQL

ClickHouse system tables change between versions. Use chronological `sql` array:

```typescript
export const myConfig: QueryConfig = {
  name: 'my-query',
  sql: [
    { since: '23.8', sql: `SELECT col1 FROM system.table` },
    { since: '24.1', sql: `SELECT col1, new_col FROM system.table` },
  ],
  columns: ['col1', 'new_col'],
}
```

The runtime picks the highest `since` that is not above the server version
(24.5 picks `24.1`) and falls back to the oldest entry for older servers.
Every entry must output every name in `columns[]`, so the `23.8` entry above
should select `0 AS new_col`. Use `''` or `NULL` for string or nullable
placeholders. A short `description` per entry says what changed. Take
column names from `docs/clickhouse-schemas/tables/<table>.md`, not memory:
`system.parts` has `marks`, not `marks_count`.

### BackgroundBar Columns

When asked to "format background bar for: X, Y, Z", each column needs 3 SQL columns:

```sql
-- For "rows"
rows,                                                                    -- base
formatReadableQuantity(rows) AS readable_rows,                           -- display
round(rows * 100.0 / nullIf(max(rows) OVER (), 0), 2) AS pct_rows       -- percentage
```

Put `readable_rows` in `columns[]` with `ColumnFormat.BackgroundBar`.
`background-bar-format.tsx` strips a leading `readable_` from the column key
and reads `pct_<rest>` for the bar width and `<rest>` for the tooltip. A
computed value (a ratio) needs no `readable_` column: compute it in a CTE, then
add `pct_ratio` in the outer `SELECT`. `background-bar-companions.test.ts`
fails any registered config whose BackgroundBar column has no `pct_` companion.

### Optional Tables

Mark tables that may not exist with `optional: true`:

```typescript
export const backupsConfig: QueryConfig = {
  name: 'backups',
  optional: true,
  tableCheck: 'system.backup_log',
  sql: 'SELECT * FROM system.backup_log',
}
```

## Verifying SQL

CI's `test-queries-config` job runs every config against a real ClickHouse
(25.8 and 26.8) but is not a required check, and its `*-live` tests self-skip
without `CLICKHOUSE_HOST`. Incident: #4081 merged an `unused-tables` config
whose `WITH x -> ... AS quote_if_needed` lambda failed under
`enable_analyzer=0`; main went red until #4084. `pnpm run test:query-config:live`
(`scripts/test-query-config-live.sh`) reproduces that failure locally: it starts
a throwaway ClickHouse with the stock system logs enabled and runs the CI test
set. Verified both ways on 26.5: the buggy config fails the live
output-columns test, the fixed one passes 1238 of 1238. Do not use the
default-analyzer-only result of an ad hoc `clickhouse local` run as proof.

## Key Files

- `apps/dashboard/src/types/query-config.ts` — type definitions
- `apps/dashboard/src/lib/query-config/` — query configs, registered in `index.ts`
- `apps/dashboard/src/lib/api/chart-registry.ts` — chart query registry
- `apps/dashboard/src/lib/api/table-registry.ts` — table query registry
- `packages/clickhouse-client/src/clickhouse-version.ts` — server version parsing
- `docs/clickhouse-schemas/tables/<table>.md` — column availability per version

## See Also

- `.claude/skills/clickhouse-query-config/SKILL.md` — the agent-facing rules
- `packages/clickhouse-client/src/table-validator.ts` — validates table
  existence before queries
- `packages/clickhouse-client/src/table-existence-cache.ts` — caches validation
  results (5-min TTL)
