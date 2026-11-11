# Agent Instructions: ClickHouse Schema Maintenance

Canonical instructions for every coding agent working on ClickHouse query
configurations. `CLAUDE.md` in this folder is a stub that includes this file —
edit **this** file only.

## When to Read This

Read this document when you are:
- Adding or modifying queries in `apps/dashboard/src/lib/query-config/`
- Debugging query failures on specific ClickHouse versions
- Adding version-specific query variants
- Working with system tables (`system.*`)

## Context loading

When adding or modifying a query config:

1. Identify every `system.*` table in the SQL (`FROM`, `JOIN`, subqueries).
2. Read `tables/{table}.md` for each of those tables.
3. Check the **Version Compatibility Matrix** in each table file.
4. If a column is not available on all versions from 23.8+, use a versioned
   `sql: [{ since, sql }]` list with one entry per version boundary.

Then: follow existing patterns in `apps/dashboard/src/lib/query-config/`, write
the config, add since-gated entries if needed, and verify with
`pnpm run type-check`.

For fuller query-config patterns, use the `clickhouse-query-config` skill.

## Pre-Modification Checklist

Before modifying any query configuration:

1. [ ] Read `tables/{table}.md` for each system table in the query
2. [ ] Check `v{version}.md` for breaking changes if targeting specific version
3. [ ] Review existing patterns in `apps/dashboard/src/lib/query-config/`

## Query Variant Decision Tree

```
Does your query use system.* tables?
├── No → No version gates needed
└── Yes → Check column availability
    ├── All columns exist in v23.8+ → No version gates needed
    └── Some columns missing in older versions → Add since-gated sql entries
```

## Adding a Version Variant

When column availability differs across versions:

```typescript
// In apps/dashboard/src/lib/query-config/queries/your-config.ts

export const yourConfig: QueryConfig = {
  name: 'your-query',

  // Chronological, oldest → newest. `selectVersionedSql` picks the entry
  // with the highest `since` that is <= the server version.
  sql: [
    { since: '23.8', sql: `SELECT col1, col2 FROM system.table` },
    { since: '24.1', sql: `SELECT col1, col2, new_col FROM system.table` },
  ],

  columns: ['col1', 'col2', 'new_col'],
}
```

## How `since` Selection Works

`selectVersionedSql` (`packages/clickhouse-client/src/clickhouse-version.ts`)
compares the server version against each entry's `since` and takes the entry
with the **highest `since` that is <= the server version**. There is no range
string, no `<24.1` syntax, and no `variants` key on `QueryConfig` — write the
array chronologically (oldest `since` first) and the picker does the rest.

| Server version | Entries | Picked |
|----------------|---------|--------|
| 23.8.x         | `23.8`, `24.1` | `23.8` |
| 24.0.x         | `23.8`, `24.1` | `23.8` |
| 24.1+          | `23.8`, `24.1` | `24.1` |

## Key Version Boundaries

See `docs/clickhouse-schemas/index.md` for the maintained Version Matrix
(matched against `scripts/ch-schema/constants.ts` `LTS_VERSIONS`). The two
boundaries chmonitor configs use most:

### v23.8 (LTS)
- Enterprise baseline; the `since` gate floor for versioned SQL

### v24.1
- Added: `query_cache_usage` in system.query_log
- Added: `peak_threads_usage` in system.processes

## Common Mistakes to Avoid

1. **Don't assume column exists** - Always check `tables/{table}.md`
2. **Don't forget `since` gates** - If a column was added in v24.1, add a `{ since: '23.8', … }` entry for the older shape
3. **Don't hardcode versions** - Use `since` gates, never `if (version >= …)` in config SQL
4. **Test on multiple versions** - Verify queries work on target versions

## File Locations

| What | Where |
|------|-------|
| Table schemas | `tables/*.md` |
| Version changes | `v*.md` |
| Query configs | `apps/dashboard/src/lib/query-config/**/*.ts` |
| Chart queries | `apps/dashboard/src/lib/api/charts/*.ts` |
| Version utils | `packages/clickhouse-client/src/clickhouse-version.ts` |
