# ClickHouse Schema Documentation

This directory contains version-specific schema documentation for ClickHouse system tables. Used to maintain version-aware queries in this monitoring application.

## Purpose

ClickHouse system tables (`system.query_log`, `system.processes`, etc.) change their schema between versions. This documentation helps:

1. **Developers** understand which columns are available in which versions
2. **AI Agents** generate correct queries for specific ClickHouse versions
3. **Maintainers** add version-specific query variants

## Directory Structure

```
docs/clickhouse-schemas/
├── README.md           # This file
├── AGENTS.md           # Instructions for AI agents
├── CLAUDE.md           # Stub that includes AGENTS.md
├── index.md            # Version matrix overview
├── v23.1.md            # Changes in version 23.1
├── v23.8.md            # Changes in version 23.8 (LTS)
├── v24.1.md            # Changes in version 24.1
├── ...
└── tables/
    ├── processes.md    # system.processes full history
    ├── query_log.md    # system.query_log full history
    ├── parts.md        # system.parts full history
    └── ...
```

## Key Version Boundaries

| Version | Type | Notable Changes |
|---------|------|-----------------|
| 23.8 | LTS | Stable baseline for enterprise |
| 24.1 | Regular | Added query_cache_usage, peak_threads_usage |
| 24.3 | Regular | [Document changes] |
| 24.8 | LTS | [Document changes] |

## Updating This Documentation

Run the CLI tool to regenerate from ClickHouse changelog:

```bash
bun run scripts/build-ch-schema-docs.ts
```

Or update specific version/table:

```bash
bun run scripts/build-ch-schema-docs.ts --version 24.1
bun run scripts/build-ch-schema-docs.ts --table query_log
```

## Related Files

- Query configs: `lib/query-config/`
- Version utilities: `lib/clickhouse-version.ts`
- Type definitions: `types/query-config.ts`
