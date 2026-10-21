---
name: clickhouse-query-config
description: Version-aware ClickHouse query configs. Use when adding or changing a QueryConfig in apps/dashboard/src/lib/query-config/, adding a BackgroundBar column, or fixing a query that fails on one ClickHouse version.
---

# ClickHouse query config

Detail and examples live in
[docs/knowledge/query-config-format.md](../../../docs/knowledge/query-config-format.md).

## Before you edit

1. List every system table the SQL reads.
2. Read `docs/clickhouse-schemas/tables/<table>.md` for each one. Its
   compatibility matrix says which version added each column.
3. Copy the shape of a neighbouring config in
   `apps/dashboard/src/lib/query-config/`.

## Rules

- A column missing from any supported version needs a versioned `sql` array
  (`VersionedSql[]`, ordered oldest to newest). The runtime picks the highest
  `since` that is not above the server version, and falls back to the oldest.
- Every entry in the array outputs the same columns as `columns[]`. Fill a
  column an old version lacks with a placeholder: `0 AS col`, `'' AS col`, or
  `NULL AS col`.
- A `ColumnFormat.BackgroundBar` column `X` (or `readable_X`) needs a
  `pct_X` column in the SQL, 0 to 100:
  `round(X * 100.0 / nullIf(max(X) OVER (), 0), 2) AS pct_X`.
  `background-bar-companions.test.ts` fails without it.
- A table that may not exist (`system.backup_log`, `system.error_log`,
  `system.zookeeper`) gets `optional: true` and `tableCheck`.
- Register a new config in `apps/dashboard/src/lib/query-config/index.ts`.

## Verify

CI runs `test-queries-config` against real ClickHouse 25.8 and 26.8. That job
is **not a required check**, so auto-merge can land a PR while it is running or
red, and the `*-live` tests skip themselves when `CLICKHOUSE_HOST` is unset.
For any SQL change, run the live suite yourself:

```sh
pnpm run test:query-config:live          # scripts/test-query-config-live.sh
pnpm run test:query-config:live -t unused-tables   # extra args go to bun test
```

It starts a throwaway local ClickHouse (system logs enabled like the stock
image, torn down on exit) and runs the same tests as CI. Then, from
`apps/dashboard`: `bun test src/lib/query-config/background-bar-companions.test.ts`
plus the touched config's tests, and `pnpm run type-check` (the root
type-check skips `apps/dashboard`). Before merging a PR that touches SQL, wait
for both `test-queries-config` jobs to finish green.

SQL rules the live suite enforces:

- It runs every config with `enable_analyzer=0` as well as the default. A
  lambda alias in `WITH` (`x -> ... AS name`) is not visible from `WHERE` in the
  old analyzer (`Code: 46 Unknown function`; #4081, fixed in #4084). Inline the
  expression instead.
- Qualify columns and avoid output aliases that shadow source columns.
- A config whose `tableCheck` table is missing is skipped, not tested, so make
  sure the server really has that table before trusting a green run.
