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
├── index.md            # Version matrix overview (the maintained index)
├── v24.1.md            # Version notes (one file per release with deltas)
├── v25.12.md           # …
├── v26.6.md
├── v26.10.md
└── tables/
    ├── processes.md    # system.processes full history
    ├── query_log.md    # system.query_log full history
    ├── parts.md        # system.parts full history
    └── ...
```

The per-version files cover only releases that carry named deltas; older
baseline versions (23.8 enterprise baseline and friends) are matrix rows in
`index.md`, not files. `index.md` also tracks the `LTS_VERSIONS` pins.

## Key Version Boundaries

See `index.md` — the Version Matrix there is the maintained list and matches
`scripts/ch-schema/constants.ts` `LTS_VERSIONS`. The boundaries chmonitor
query configs actually use: 23.8 (LTS, enterprise baseline and the `since`
gate floor), 24.1 (`query_cache_usage`, `peak_threads_usage`), and the 26.x
LTS lines.

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

- Query configs: `apps/dashboard/src/lib/query-config/`
- Version utilities: `packages/clickhouse-client/src/clickhouse-version.ts`
- Type definitions: `apps/dashboard/src/types/query-config.ts`
