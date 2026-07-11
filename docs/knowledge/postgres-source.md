---
id: postgres-source
type: spec
related:
  - cloud-saas-mode
  - billing-checkout-flow
  - deployment
  - conventions
  - ai-insights
tags: [postgres, multi-engine, connections, agent, feature-flag, insights]
updated: 2026-07-11
---

# Postgres as a monitored source (multi-engine architecture)

chmonitor monitors more than ClickHouse: epic #2264 (merged 2026-07-11, PRs
#2569–#2574) added **Postgres** as a read-only monitored source and introduced
the **engine dimension** across the product. This note is the map of how it
fits together.

## The engine dimension

`SourceEngine = 'clickhouse' | 'clickhouse-cloud' | 'postgres'` lives in
`packages/types/src/source-engine.ts`. It is orthogonal to the storage-origin
`source` (`env | demo | browser | database`): *source* says where credentials
live, *engine* says what speaks on the other end. `clickhouse-cloud` is
wire-identical to `clickhouse` — it exists for badges/menu affordances and
future cloud-specific pages.

- D1 `user_connections.engine` (migration `0018`, default `'clickhouse'`,
  fail-closed for pre-existing rows).
- `getHostEngineMeta(engine)` in `lib/host-permissions.ts` renders the engine
  badge; `canEditHost`/`getHostSourceMeta` (storage-origin) are unchanged.
- Everything is gated by **`CHM_FEATURE_POSTGRES_SOURCE`** (pure env flag,
  default off, fail-closed — same philosophy as `lib/cloud` / `lib/edition`).
  Flag off ⇒ zero behavioral/visual diff, enforced by unit tests.

## One pg code path, both runtimes (the feasibility result)

`packages/postgres-client` wraps the standard `pg` driver: in the Cloudflare
Worker it auto-selects `pg-cloudflare` (`cloudflare:sockets` raw TCP,
`nodejs_compat`); on Node (Docker/K8s) it uses `net.Socket`. Proven by POC in
real workerd (evidence on #2449) — **no Hyperdrive dependency, no HTTP proxy,
full OSS parity**. Plan 42's "no DB backends on Workers" ruling was
Kafka-specific and was deliberately revisited.

- `queryPostgres(config, sql, params?)` is THE read-only query path: connects
  per request, pins `default_transaction_read_only=on` (the authoritative
  guard), gates to a single SELECT/WITH/SHOW/EXPLAIN/TABLE/VALUES statement,
  always uses the extended protocol. **Never add a second pg access path.**
- Bundling: adding a dep to a bundled `packages/*` member needs root + app
  lockfiles, `ssr.noExternal`, AND `resolve.dedupe` in
  `apps/dashboard/vite.config.ts` (the Docker builder has no per-package
  node_modules — this broke once as #2572).
- SSRF: `validatePostgresHost(host, port)` (TCP-aware sibling of the HTTP
  validator in `lib/browser-connections/host-url.ts`) must run on every path
  that connects to a user-supplied host. Credentials use envelope **v2**
  (`kind/port/database/sslmode`); v1 payloads decode as ClickHouse.
- Connection errors: `lib/connection-errors.ts` speaks PG SQLSTATE (28P01,
  3D000 → `database_not_found`, 08006, …).

## Two id spaces — never overload `hostId`

ClickHouse `hostId` (env lists + D1 + browser, `?host=N`) is CH-only.
Postgres sources ride a **separate** space:

- **UI/pages**: per-user connections filtered `engine==='postgres'`, routed
  via `?pg=<connectionId>`; `useActiveHostEngine()` resolves the active
  engine. PG hosts are deliberately excluded from `useMergedHosts` so they can
  never be mis-queried as a CH `hostId`.
- **Agent tools**: env-list `pgHostId` via `getPostgresConfigs()`
  (`POSTGRES_HOST/PORT/USER/PASSWORD/DATABASE/SSLMODE/NAME` comma-lists),
  mirroring `getClickHouseConfigs`. Per-user D1 PG sources are not yet
  agent-visible (same limitation as CH agent tools).

## Engine-aware menu (decision 4 of #2447)

`MenuItem.engines?: SourceEngine[]` (absent = ClickHouse family) filtered in
ONE place — `getVisibleMenuItems(config, engine)` (`lib/menu/visible-items.ts`)
— so sidebar, ⌘K palette, and breadcrumbs stay consistent. Switching to a
Postgres host swaps the menu to `/postgres/queries` (pg_stat_statements slow
patterns + flyout) and `/postgres/activity` (pg_stat_activity). Missing
`pg_stat_statements` renders a graceful EmptyState with enable instructions
(the PG analog of the `optional`/`tableCheck` pattern).

## Agent surface

Four tools (gated off with the flag, absent when disabled):
`run_postgres_select_query`, `get_postgres_metrics` (now includes
`max_connections` + connection saturation %), `list_postgres_slow_query_patterns`,
and `get_postgres_table_stats` (dead-tuple bloat + last autovacuum/analyze +
unused indexes) — mirroring ClickHouse Cloud's own set. Cross-source correlation
is prompting-only (both tool sets in one conversation); no bespoke join
primitive. The `migration-patterns` skill carries the Postgres→ClickHouse section
(type mapping, PK→ORDER BY, PeerDB as the recommended CDC path; ClickPipes is the
managed analog).

## AI Insights surface

Postgres is a first-class source for the AI Insights engine (env-gated by the
same flag). Deterministic collectors (`postgres-collectors.ts` + pure
`postgres-checks.ts`) run per env `pgHostId`, findings are persisted in the SAME
`InsightsStore` under a **reserved host offset** so they never collide with a
ClickHouse `hostId` (dismissal keys are engine-prefixed `pg:<id>:…`), the cron
sweep generates them after the ClickHouse loop, and a compact
`PostgresInsightsPanel` surfaces them on `/postgres/queries`. Full design +
namespacing rationale in [ai-insights.md](ai-insights.md) ("Postgres insights").

## Open follow-ups

Billing before GA (PG free during beta — #2447 decision 3); unify env PG
hosts with the UI switcher; agent visibility for per-user PG connections;
live TLS verification against a remote Postgres; Hyperdrive as optional
Cloud-only pooling.

## Local dev/test recipe

```bash
docker run -d --name chm-pg -e POSTGRES_PASSWORD=pass -p 54329:5432 \
  postgres:17 -c shared_preload_libraries=pg_stat_statements
# then: CREATE EXTENSION pg_stat_statements;  (and set CHM_ALLOW_PRIVATE_HOSTS=true for localhost)
```
