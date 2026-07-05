# Claude Code: ClickHouse Query Config Maintenance

This guide is specifically for Claude Code when working on ClickHouse query configurations.

## Context Loading Protocol

When the user asks you to add or modify a query config:

### Step 1: Identify System Tables

Parse the SQL to find all `system.*` tables:
- `FROM system.processes` → Note: processes
- `JOIN system.query_log` → Note: query_log
- Subqueries count too

### Step 2: Load Schema Context

For each table identified, read the schema file:

```
Read: docs/clickhouse-schemas/tables/processes.md
Read: docs/clickhouse-schemas/tables/query_log.md
```

### Step 3: Check Version Compatibility

In each table file, find the **Version Compatibility Matrix** section.
Note which columns are available in which versions.

### Step 4: Determine Variant Need

If any column is NOT available in all versions from 23.8+:
- Add a `variants` array to the QueryConfig
- Create variant for each version boundary

## Implementation Workflow

1. **Read the schema docs** for relevant tables
2. **Check existing patterns** in `lib/query-config/`
3. **Write the config** following patterns
4. **Add variants** if needed
5. **Verify types** compile with `pnpm run type-check`

## Quick Reference

### QueryConfig Structure

```typescript
interface QueryConfig {
  name: string           // Unique identifier
  sql: string            // Default SQL (latest version)
  variants?: Array<{     // Version-specific alternatives
    versions: string     // Semver range
    sql: string          // SQL for this range
    description?: string // What's different
  }>
  columns: string[]      // Column names
  columnFormats?: {...}  // Formatting options
  // ... other fields
}
```

### Semver Ranges

```
<24.1       → versions below 24.1
>=24.1      → versions 24.1 and above
>=23.8 <24.1 → range from 23.8 to 24.0.x
```

## Invoke the Skill

If you need detailed guidance, invoke the skill:

```
/skill clickhouse-query-config
```

This will load comprehensive patterns and examples.
