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

CI runs `test-queries-config` against real ClickHouse 25.8 and 26.8. Locally,
from `apps/dashboard`: `bun test src/lib/query-config/background-bar-companions.test.ts`
plus the touched config's tests, then `pnpm run type-check` (the root
type-check skips `apps/dashboard`).
