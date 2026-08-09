---
title: ClickHouse Schema Version Index
---

# ClickHouse System Table Schema Index

## Version Matrix

Key system-table deltas that affect chmonitor monitoring queries. LTS rows match
`scripts/ch-schema/constants.ts` `LTS_VERSIONS`. Query configs use `VersionedSql`
`since` gates for columns that are unavailable on older hosts.

| Version | Release | Type | Key Changes |
|---------|---------|------|-------------|
| 23.1 | 2023-01 | Regular | Baseline |
| 23.3 | 2023-03 | LTS | Stable LTS |
| 23.8 | 2023-08 | LTS | Enterprise baseline |
| 24.1 | 2024-01 | Regular | `query_log.query_cache_usage`; `processes.peak_threads_usage` (see table notes) |
| 24.3 | 2024-03 | LTS | LTS maintenance line |
| 24.8 | 2024-08 | LTS | LTS maintenance line |
| 24.10 | 2024-10 | Regular | Replicated DB health columns used by clusters topology |
| 25.1 | 2025-01 | Regular | Keeper presence / histogram metrics surfaces used by configs |
| 25.4 | 2025-04 | Regular | `system.scheduler`, `system.workloads` monitoring |
| 25.8 | 2025-08 | LTS | Current 25.x LTS; keeper connection log surfaces |
| 25.12 | 2025-12 | Regular | `mutations.parts_in_progress_names`; background schedule pool tables |
| 26.1 | 2026-01 | Regular | `system.parts.files` (part file-count / fragmentation) |
| 26.2 | 2026-02 | Regular | `mutations.parts_postpone_reasons` (not yet selected in UI) |
| 26.3 | 2026-03 | LTS | Current 26.x LTS |
| 26.6 | 2026-06 | Regular | `client_agent` on query_log/processes; merge projection progress columns |
| 26.7 | 2026-07 | Regular | Current stable train head (patch releases continue on 26.7.x) |

**Upstream pins (research 2026-08-10):** latest stable tag `v26.7.3.19-stable`; LTS tags `v26.3.17.110-lts`, `v25.8.29.51-lts`.

## Monitored System Tables

| Table | Category | Documentation |
|-------|----------|---------------|
| system.processes | Query Monitoring | [tables/processes.md](tables/processes.md) |
| system.query_log | Query Monitoring | [tables/query_log.md](tables/query_log.md) |
| system.parts | Storage | [tables/parts.md](tables/parts.md) |
| system.merges | Operations | [tables/merges.md](tables/merges.md) |
| system.replicas | Replication | [tables/replicas.md](tables/replicas.md) |
| system.tables | Metadata | [tables/tables.md](tables/tables.md) |
| system.columns | Metadata | [tables/columns.md](tables/columns.md) |
| system.disks | Storage | [tables/disks.md](tables/disks.md) |
| system.clusters | Cluster | [tables/clusters.md](tables/clusters.md) |
| system.mutations | Operations | [tables/mutations.md](tables/mutations.md) |

## Quick Links

- [Agent Instructions](AGENTS.md) - For AI agents
- [Claude Code Guide](CLAUDE.md) - For Claude Code
- [README](README.md) - Overview
- Per-version notes: [v24.1](v24.1.md), [v25.12](v25.12.md), [v26.1](v26.1.md), [v26.2](v26.2.md), [v26.6](v26.6.md)

## Updating These Docs

```bash
# Regenerate from changelog + KNOWN_COLUMN_CHANGES seed (network)
bun run scripts/build-ch-schema-docs.ts

# Specific version
bun run scripts/build-ch-schema-docs.ts --version 26.6

# Specific table
bun run scripts/build-ch-schema-docs.ts --table query_log

# Regenerate user-facing support matrix from LTS_VERSIONS / majors
bun run scripts/build-support-matrix.ts
```

Seed data for incomplete changelog parsing lives in
`scripts/ch-schema/constants.ts` (`KNOWN_COLUMN_CHANGES`, `LTS_VERSIONS`).
