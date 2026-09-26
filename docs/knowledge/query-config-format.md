---
id: query-config-format
title: QueryConfig Format
type: spec
status: active
updated: 2026-09-27
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

Each data view uses a `QueryConfig` type (`types/query-config.ts`) that defines:

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

### BackgroundBar Columns

When asked to "format background bar for: X, Y, Z", each column needs 3 SQL columns:

```sql
-- For "rows"
rows,                                                                    -- base
formatReadableQuantity(rows) AS readable_rows,                           -- display
round(rows * 100.0 / nullIf(max(rows) OVER (), 0), 2) AS pct_rows       -- percentage
```

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

## Key Files

- `types/query-config.ts` — type definitions
- `lib/query-config/` — centralized query configurations
- `lib/api/chart-registry.ts` — chart query registry
- `lib/api/table-registry.ts` — table query registry
- `docs/clickhouse-schemas/` — column availability per version

## See Also

- `.claude/skills/clickhouse-query-config.md` — Claude skill guidance
- `packages/clickhouse-client/src/table-validator.ts` — validates table
  existence before queries
- `packages/clickhouse-client/src/table-existence-cache.ts` — caches validation
  results (5-min TTL)
