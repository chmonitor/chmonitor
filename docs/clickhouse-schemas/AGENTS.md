# Agent Instructions: ClickHouse Schema Maintenance

Canonical instructions for every coding agent working on ClickHouse query
configurations. `CLAUDE.md` in this folder is a stub that includes this file —
edit **this** file only.

## When to Read This

Read this document when you are:
- Adding or modifying queries in `lib/query-config/`
- Debugging query failures on specific ClickHouse versions
- Adding version-specific query variants
- Working with system tables (`system.*`)

## Context loading

When adding or modifying a query config:

1. Identify every `system.*` table in the SQL (`FROM`, `JOIN`, subqueries).
2. Read `tables/{table}.md` for each of those tables.
3. Check the **Version Compatibility Matrix** in each table file.
4. If a column is not available on all versions from 23.8+, add a `variants`
   array (or a versioned `sql: [{ since, sql }]` list) for each version
   boundary.

Then: follow existing patterns in `lib/query-config/`, write the config, add
variants if needed, and verify with `pnpm run type-check`.

For fuller query-config patterns, use the `clickhouse-query-config` skill.

## Pre-Modification Checklist

Before modifying any query configuration:

1. [ ] Read `tables/{table}.md` for each system table in the query
2. [ ] Check `v{version}.md` for breaking changes if targeting specific version
3. [ ] Review existing patterns in `lib/query-config/`

## Query Variant Decision Tree

```
Does your query use system.* tables?
├── No → No variants needed
└── Yes → Check column availability
    ├── All columns exist in v23.8+ → No variants needed
    └── Some columns missing in older versions → Add variants
```

## Adding a Version Variant

When column availability differs across versions:

```typescript
// In lib/query-config/queries/your-config.ts

export const yourConfig: QueryConfig = {
  name: 'your-query',

  // Default: query for LATEST ClickHouse versions
  sql: `SELECT col1, col2, new_col FROM system.table`,

  // Variants for older versions (first match wins)
  variants: [
    {
      versions: '<24.1',  // Semver range
      description: 'Pre-24.1: new_col not available',
      sql: `SELECT col1, col2 FROM system.table`,
    },
  ],

  columns: ['col1', 'col2', 'new_col'],
}
```

## Semver Range Quick Reference

| Pattern | Matches | Does NOT Match |
|---------|---------|----------------|
| `<24.1` | 23.x, 24.0.x | 24.1+, 25.x |
| `>=24.1` | 24.1+, 25.x | 23.x, 24.0.x |
| `>=23.8 <24.1` | 23.8.x, 24.0.x | 23.7.x, 24.1+ |

## Key Version Boundaries

### v23.8 (LTS)
- Stable baseline
- Use as minimum version for enterprise support

### v24.1
- Added: `query_cache_usage` in system.query_log
- Added: `peak_threads_usage` in system.processes

### v24.8 (LTS)
- [Document key changes when known]

## Common Mistakes to Avoid

1. **Don't assume column exists** - Always check `tables/{table}.md`
2. **Don't forget variants** - If column added in v24.1, add variant for <24.1
3. **Don't hardcode versions** - Use semver ranges for flexibility
4. **Test on multiple versions** - Verify queries work on target versions

## File Locations

| What | Where |
|------|-------|
| Table schemas | `docs/clickhouse-schemas/tables/*.md` |
| Version changes | `docs/clickhouse-schemas/v*.md` |
| Query configs | `lib/query-config/**/*.ts` |
| Chart queries | `lib/api/charts/*.ts` |
| Version utils | `lib/clickhouse-version.ts` |
