---
id: ai-insights
title: AI Insights Engine
type: spec
status: active
updated: 2026-10-22
tags:
  - insights
  - findings
  - overview
  - ai
  - dismissal
  - postgres
  - peerdb
related:
  - mcp-server
  - query-config-format
  - conventions
  - agentstate-conversation-store
  - agent-conversation-storage
  - postgres-source
---

# AI Insights Engine

AI-suggested insights surfaced on the overview page (`/overview`). Insights are
short, actionable observations about a cluster — "error rate climbing", "table X
is fragmented", "replication is lagging" — generated and **cached server-side**,
**dismissible per-user**, and refreshable on demand.

## Pipeline

`collect → enrich (optional LLM) → persist → read → render`

| Stage | Module |
|-------|--------|
| Collect (deterministic) | `src/lib/insights/collectors.ts` |
| Operational classifiers (pure) | `src/lib/insights/operational-checks.ts` |
| Schema-optimization mapper (pure) | `src/lib/insights/schema-optimizations.ts` |
| Enrich (optional LLM) | `src/lib/insights/llm-enrich.ts` |
| Orchestrate + persist | `src/lib/insights/generate-insights.ts` |
| Read + de-dupe | `src/lib/insights/read-insights.ts` |
| Types + stable key | `src/lib/insights/types.ts` |

- **Collectors** run read-only ClickHouse queries (anomaly recent-vs-baseline,
  storage fragmentation/compression, readonly replicas, replication lag),
  porting the SQL/severity heuristics from the agent's
  `lib/ai/agent/tools/insight-tools.ts` (the same file as `explain_anomaly_score`
  — there is no separate `anomaly-tools.ts`). They **never throw** — any failure
  yields `[]` so the feature degrades on read-only clusters or missing system
  tables.
- **Schema-optimization collector** (`collectSchemaOptimizations` in
  `collectors.ts`, category `optimization`) reuses the query advisor's
  `analyzeQuery` (`lib/ai/advisor/recommendation-engine.ts`) — the same engine
  behind the agent's `get_optimization_recommendations` tool. It pulls a few
  (≤3) of the heaviest recent `SELECT`s (one per `normalized_query_hash`), runs
  the read-only advisor (EXPLAIN + `system.tables`/`columns`/`parts`/
  `data_skipping_indexes`) on each, and surfaces the ranked skip-index /
  projection / partition-key / PREWHERE recommendations as `info` insights. The
  ranking + mapping is a pure function in `schema-optimizations.ts`
  (`selectSchemaOptimizations`), unit-tested without I/O. **Determinism is
  load-bearing:** the `metric` (`schema_opt:<kind>:<db>.<table>:<title-slug>`)
  and `title` derive only from kind/table/title — never from the run-to-run
  impact estimate — so a dismissed suggestion does not resurrect when the
  estimate shifts; impact numbers ride in `detail`/`value` only (not part of the
  stable key). The distinct per-recommendation `metric` is also what stops the
  `${category}:${metric}` dedup in `collectInsights` from collapsing several
  suggestions into one. `deriveAction` returns a generic "Ask the agent"
  deep-link for `category === 'optimization'` (the full DDL only survives the
  immediate `generate()` response, not the scalar findings store).
- **Anomaly checks are direction-aware.** Each `AnomalyCheck` declares
  `alertOn: 'above' | 'below' | 'both'` and a `unit`
  (`bytes | ms | percent | count`). `decideSeverity` suppresses a deviation whose
  sign the check does not alert on — in BOTH the baseline and static-threshold
  paths — so memory / p95 / error rate falling below baseline never fires a
  warning, and `directionalTitle` picks `titleBelow` when a `'both'` check does
  fire on a drop. Titles must therefore never hardcode a direction the check can
  contradict ("Memory usage spiked" over a below-baseline value was the bug this
  fixed, 2026-08-12).
- **Card copy is humanized at generation time.** Findings are persisted as text,
  so raw numbers baked into `detail` live on in the store: format with
  `formatMetricValue` (bytes → `formatReadableSize`, ms → `840ms` / `4.2s`,
  percent rounded, counts locale-formatted) before writing. `formatBaselineDetail`
  emits ONE sentence — `Now 2.23 GiB — 2.24σ above its 7-day baseline (typical
  ~2.07 GiB).` — the mean/stddev/n fit belongs in the detail dialog, not the card
  body. Older raw-number findings age out on the next regeneration sweep.
- **Operational collectors** (`collectOperational` in `collectors.ts`) add cheap
  point-in-time checks across categories — each a single count/aggregate on a
  small system table:

  | Metric | Category | Severity | Source | Link |
  |---|---|---|---|---|
  | `broken_detached_parts` | storage | critical (any) | `system.detached_parts`, `reason` starts with `broken` | `/detached-parts` |
  | `detached_parts` | storage | info (≥10, non-broken) | `system.detached_parts`, other reasons | `/detached-parts` |
  | `stuck_mutations` | reliability | warning / critical ≥10 | `system.mutations` | `/mutations` |
  | `failed_dictionaries` | reliability | warning | `system.dictionaries` | `/dictionaries` |
  | `stuck_replication_queue` | reliability | warning / critical ≥50 | `system.replication_queue`, `num_tries > 100` or `create_time` > 1h old | `/replication-queue` |
  | `longest_running_query` | performance | warning ≥5m / critical ≥30m | `system.processes` | `/running-queries` |
  | `insert_backpressure` | performance | warning (delayed) / critical (any rejected) | `DelayedInserts` gauge in `system.metrics` + `ProfileEvent_RejectedInserts` summed over 1h in `system.metric_log` (optional; skipped when absent) | `/merges` |
  | `parts_pressure` | storage | per `classifyPartsPressure` | `system.parts` (+ `part_log`) | `/merges` |

  Their **classification is split into pure functions** in
  `operational-checks.ts` (thresholds → `InsightCandidate | null`), mirroring the
  anomaly collector's `decideSeverity`, so severity logic is unit-tested without
  ClickHouse I/O (`operational-checks.test.ts`). Every card's `detail` ends with
  a "What to do:" next step (anomaly checks carry it in `AnomalyCheck.advice`,
  appended in both the baseline and static paths). Adding a metric here **must**
  be paired with a `deriveAction` case in `read-insights.ts` — the findings store
  keeps scalars only, so the action link is re-derived from `metric`/`category`
  on every read; an unmatched metric silently loses its link after a reload.
  `read-insights.derive-action.test.ts` enforces this: it scans
  `collectors.ts`, `operational-checks.ts`, and `ttl-partition-collector.ts`
  for every literal `metric: '...'` and fails when `deriveAction` returns no
  `href` for one. Dynamic `schema_opt:*` metrics are outside the scan (they map
  to the agent deep-link by category).
- **Enrichment is optional.** When a provider key resolves
  (`isProviderConfigured(resolveProvider(DEFAULT_MODEL).providerId)`), candidates
  pass through one `generateObject` call that tightens wording. With no key (or
  on any error) candidates are returned unchanged — the "if available" half.
  The call sends `maxOutputTokens` (default 4096, `INSIGHTS_ENRICH_MAX_OUTPUT_TOKENS`,
  clamped to 16384; readers in `enrich-config.ts`) so providers do not reserve the
  model's full output limit for a short JSON answer (#4114). The health sweep
  calls `generateInsights(hostId, sweepInsightOptions())`
  (`lib/health/sweep/run-host.ts`); `INSIGHTS_SWEEP_ENRICH=false` makes it pass
  `enrich: false` (deterministic text only, like the UI auto path). Manual/UI
  generation ignores that env. Not done: skipping enrichment when the candidate
  set is unchanged, because the stored key hashes the enriched title and the 5 min
  regen throttle already covers repeat runs.
- **Persistence goes through the pluggable `InsightsStore`**
  (`src/lib/insights/store/`). The default backend is the ClickHouse findings
  store (`src/lib/findings/findings-store.ts`, `FINDINGS_TABLE`, 30-day TTL),
  which records insights with `source: 'ai-insight'` — the original behavior.
  Operators can point persistence at D1 / Postgres / AgentState instead; see
  **Persistence backends** below.

## Persistence backends

Persistence is pluggable, mirroring the agent's pluggable `ConversationStore`
(see [agentstate-conversation-store.md](agentstate-conversation-store.md) and
[agent-conversation-storage.md](agent-conversation-storage.md)). Why it exists:
the original engine wrote insights straight to a ClickHouse table on the
monitored cluster. On a read-only monitoring connection that write silently
fails, so insights never survived a reload. The `InsightsStore` interface lets
operators point persistence at a writable store instead — without granting the
monitoring user write access to the cluster it watches.

The interface (`src/lib/insights/store/types.ts`) is small — `record(hostId,
findings)` and `list(hostId, opts)` — and reuses the `Finding` / `FindingRow`
shapes from the findings store, so the read path (`read-insights.ts → toCard`)
is identical regardless of backend. **Every method is best-effort**: a backend
that cannot write (read-only cluster, missing binding) logs and returns
`false`/`[]` rather than throwing, so both the manual "Generate" endpoint and the
cron sweep stay resilient.

### Selection

Selection is **additive opt-in via a single env var**, not flag-gated. Setting
nothing keeps the original ClickHouse behavior. Backends:

| `INSIGHTS_STORE_BACKEND` | Backend | Prerequisite env / binding |
|---|---|---|
| `auto` (default) | ClickHouse | — (original behavior) |
| `clickhouse` | ClickHouse `monitoring_findings` table on the monitored cluster | writable monitoring connection |
| `d1` | Cloudflare D1 `insights_findings` table | `INSIGHTS_D1` binding, else `CHM_CLOUD_D1` |
| `postgres` | Postgres `insights_findings` table | `DATABASE_URL` |
| `agentstate` | AgentState generic State store | `AGENTSTATE_API_KEY` (+ optional `AGENTSTATE_BASE_URL`) |
| `memory` | in-process map (ephemeral) | — |

Files: `clickhouse-store.ts`, `d1-store.ts`, `postgres-store.ts`,
`agentstate-store.ts`, `memory-store.ts`; resolver `resolve-store.ts`.

- **Default is ClickHouse.** `auto` and `clickhouse` both resolve to the
  ClickHouse findings store — exactly the original behavior, so existing
  deployments are unaffected.
- **`auto` never silently follows other env.** The presence of `DATABASE_URL`
  (for conversations) does not move insights to Postgres — switching is always an
  explicit decision.
- **Fallback to ClickHouse on missing prerequisite.** If an explicitly selected
  backend is missing its prerequisite (no `DATABASE_URL`, no `AGENTSTATE_API_KEY`),
  the resolver logs a warning and falls back to ClickHouse so generation keeps
  working.
- The resolved store is memoized per process (keyed by the env value) so the
  Postgres pool / AgentState client is created once.

### Tables and mapping

- **D1 / Postgres** lazily create a dedicated `insights_findings` table on first
  use (event_time as unix ms, scalar finding columns). D1 reuses the
  conversation D1 binding (`INSIGHTS_D1` first, then `CHM_CLOUD_D1`); Postgres
  reuses `DATABASE_URL`.
- **ClickHouse** uses the existing `monitoring_findings` table with
  `source = 'ai-insight'`.
- **AgentState** reuses `AGENTSTATE_API_KEY` + optional `AGENTSTATE_BASE_URL` and
  stores each insight as a generic **State** record (not a conversation):
  - `agent_id` = `clickhouse-monitoring-insights`
  - `state_key` = `insight:<hostId>:<readable-prefix>:<fnv1a-hash>` — a bounded,
    human-readable prefix plus an FNV-1a hash of the full
    `host\0category\0metric\0title` composite. The hash makes the key both
    **stable** (an unchanged insight upserts in place — natural dedup) and
    **collision-proof**: a plain truncated `category:metric:title` would alias
    two long titles sharing a 120-char prefix into one key and silently
    overwrite one (data loss). Regression + benchmark coverage in
    `store/agentstate-store.test.ts`.
  - `tags` = [`host:<id>`, `severity:<sev>`] for server-side filtering

### Endpoint and UI

- `GET /api/v1/insights/backend` returns `{ backend }` (no secrets), failing safe
  to `clickhouse`. Mirrors `/api/v1/conversations/backend`.
- The overview AI Insights panel (`insights-panel.tsx`) shows a read-only footer
  — "Stored in `<backend>` · configured at deploy time" — via the
  `use-insights-backend.ts` hook.

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `INSIGHTS_STORE_BACKEND` | no | `auto` | `auto` \| `clickhouse` \| `d1` \| `postgres` \| `agentstate` \| `memory`. `auto`/`clickhouse` = ClickHouse findings store |
| `INSIGHTS_D1` | no | — | optional dedicated D1 binding for the `d1` backend; falls back to `CHM_CLOUD_D1` |
| `DATABASE_URL` | for `postgres` | — | reused from the conversation Postgres store |
| `AGENTSTATE_API_KEY` | for `agentstate` | — | reused from the AgentState conversation store |
| `AGENTSTATE_BASE_URL` | no | SDK default | self-host endpoint for `agentstate` |

## Postgres insights (cross-source, env-gated)

The engine also covers **Postgres** monitored sources (epic #2264), gated by
`CHM_FEATURE_POSTGRES_SOURCE` (fail-closed — flag off ⇒ zero diff). It mirrors
the ClickHouse pipeline with Postgres-specific modules:

| Stage | Module |
|-------|--------|
| Collect (deterministic PG reads) | `src/lib/insights/postgres-collectors.ts` (`collectPostgresInsights(pgHostId)`) |
| Pure classifiers | `src/lib/insights/postgres-checks.ts` |
| Orchestrate + persist | `src/lib/insights/generate-postgres-insights.ts` (`generatePostgresInsights`) |
| Read + de-dupe | `src/lib/insights/read-postgres-insights.ts` (`readPostgresInsights`) |

- **Collectors** run single read-only statements through the shared Phase-2 path
  (`runPostgresReadOnly` → `queryPostgres`, session pinned read-only) against ONE
  env-configured source (`pgHostId`, index into the `POSTGRES_*` lists — the same
  id the agent tools + cron use). They **never throw** (swallow to `[]`).
- **Checks** (each a pure fn in `postgres-checks.ts`, unit-tested in
  `postgres-checks.test.ts`): connection saturation vs `max_connections`
  (`pg_stat_activity` + `pg_settings`), buffer-cache hit ratio (`pg_stat_database`,
  guarded by a min-blocks floor so a cold server is skipped), idle-in-transaction
  + longest active query (`pg_stat_activity`), `pg_stat_statements` availability,
  worst dead-tuple bloat (`pg_stat_user_tables`), unused indexes
  (`pg_stat_user_indexes`, excluding PK/unique), replication lag, and
  rollback/deadlock ratio. Findings **reuse existing categories**
  (`performance`/`reliability`/`storage`/`optimization`) with `pg_`-prefixed
  metrics and "Postgres:" title prefixes — so the board's `CATEGORY_META` and
  filters work unchanged.
- **Namespacing decision (no migration).** The `InsightsStore` is keyed by a bare
  numeric `hostId`, and a `pgHostId` shares the integer space with a ClickHouse
  `hostId` (both can be 0). Rather than migrate the store to a composite
  `(engine,id)` key (touching all 5 backends + the D1/PG table schemas), Postgres
  findings are recorded under a **reserved host offset**:
  `pgInsightStoreHostId(pgHostId) = POSTGRES_INSIGHT_STORE_HOST_OFFSET (1_000_000)
  + pgHostId` (`types.ts`). CH env hosts are small indices and D1 user
  connections are negative, so the offset is disjoint from both — a Postgres
  source can never be read back as ClickHouse host 0. All existing ClickHouse
  keys stay **byte-identical** (zero migration). The **dismissal key** is
  separately engine-prefixed: `insightKey(pgHostId, …, 'postgres')` →
  `pg:<pgHostId>:<category>:<metric>:<title>` (readable, collision-proof, stable
  across regenerations). Covered by `insights.test.ts`.
- **Cron**: after the ClickHouse loop, `runHealthSweep` iterates
  `getPostgresConfigs()` and calls `generatePostgresInsights(pgConfig.id)` — ONLY
  when `CHM_FEATURE_POSTGRES_SOURCE === 'true'`, wrapped so a PG failure can never
  break the CH sweep. The cron route bridges `POSTGRES_*` + the flag onto
  `process.env` via `bridgePostgresEnv` (sibling of `bridgeClickHouseEnv`).
- **Manual + read**: `GET/POST /api/v1/insights/postgres?pg=<id>` (feature-gated,
  fail-closed to a `disabled`-flagged empty payload). POST self-enforces the same
  write gate as the ClickHouse generate route.
- **UI**: `PostgresInsightsPanel` (`components/postgres/postgres-insights-panel.tsx`)
  renders above the slow-query table on `/postgres/queries` via
  `usePostgresInsights`. Reuses `InsightCard` (given an optional `linkSearch` prop
  so deep-links carry the active `?pg=` connection instead of `?host`). Keyed by
  the env source id (default 0); renders nothing when there are no findings.
  **Limitation**: the env `pgHostId` space (agent/cron/insights) is not yet
  unified with the UI's per-user D1 `?pg=` connections (an existing open
  follow-up in [postgres-source.md](postgres-source.md)).

## PeerDB insights (env-wide, gated)

PeerDB is the third insights source (issue #3439, PR #3448), gated by the
PeerDB env config — `PEERDB_API_URL` unset ⇒ zero diff, the same fail-closed
shape as `CHM_FEATURE_POSTGRES_SOURCE` for Postgres. It mirrors the ClickHouse
and Postgres pipelines with PeerDB-specific modules. It is the sibling of the
**Postgres insights** section above, on the same engine-dimension footing (see
[postgres-source.md](postgres-source.md)):

| Stage | Module |
|-------|--------|
| Collect (read-only PeerDB REST) | `src/lib/insights/peerdb-collectors.ts` (`collectPeerDBInsights`) |
| Pure classifiers | `src/lib/insights/peerdb-checks.ts` |
| Orchestrate + persist | `src/lib/insights/generate-peerdb-insights.ts` (`generatePeerDBInsights`) |
| Read + de-dupe | `src/lib/insights/read-peerdb-insights.ts` (`readPeerDBInsights`) |

- **Collectors read REST, not SQL.** The ClickHouse alert sweep is
  SQL-rule-centric, so PeerDB gets a dedicated collector path instead of a fake
  `AlertRuleDef.sql`. `PeerDBSnapshotReader` is the injectable snapshot source;
  the default reads the env-configured flow-api through the same
  `envPeerDBConfig` / `buildPeerDBAuthHeader` path the `/api/v1/peerdb/*` proxy
  uses, so `basic` AND `bearer` deployments collect identically.
  `collectPeerDBInsights` fans out per mirror, bounded by
  `PEERDB_SWEEP_MAX_MIRRORS` (50), caps per-mirror findings at 5 so a
  fleet-wide outage surfaces the fleet card plus a sample, and de-dupes on
  `${category}:${metric}` like `collectInsights`. Collectors **never throw** —
  unconfigured or unreachable PeerDB, or one failed upstream call, yields `[]`
  (or a partial snapshot), so a PeerDB failure can never break the sweep around
  it.
- **Checks** (each a pure fn in `peerdb-checks.ts`, unit-tested in
  `peerdb-checks.test.ts` and driven end-to-end with a stub reader in
  `peerdb-collectors.test.ts`): failed mirrors (`peerdb_failed_mirrors`,
  critical), paused mirrors (`peerdb_paused_mirrors`, info), terminated mirrors
  (`peerdb_terminated_mirrors`, warning), absolute worst-slot lag
  (`peerdb_slot_lag_mb`), lag **divergence** across the history window
  (`peerdb_slot_lag_trend`), per-mirror error volume
  (`peerdb_mirror_errors:<slug>`), and per-mirror snapshot progress: an
  unfinished snapshot is an `info` card (`peerdb_snapshot_in_progress:<slug>`)
  that becomes a `warning` (`peerdb_snapshot_stalled:<slug>`) only after
  `PEERDB_SNAPSHOT_STALL_MS` (24h) from the earliest clone `startTime` (#3516). Findings **reuse the existing categories**
  (`reliability` / `performance`) with `peerdb_`-prefixed metrics and
  `"PeerDB:"-prefixed` titles — so the board's `CATEGORY_META` and filters work
  unchanged, exactly as the Postgres findings reuse `pg_`-prefixed metrics.
  Slot-lag thresholds are imported from the shared
  `lib/peerdb/slot-lag-thresholds.ts` (the same source as the fleet UI's
  `slotHealth`), so the insights panel and the `/peerdb` slot-health table cannot
  disagree about what "lagging" means.
- **Namespacing decision (no migration).** Same shape as the Postgres reserved
  offset, one band higher: `peerdbInsightStoreHostId(sourceId) =
  PEERDB_INSIGHT_STORE_HOST_OFFSET (2_000_000) + sourceId` (`types.ts`). PeerDB
  findings are recorded under that host key, so a ClickHouse or Postgres read
  can never return them, and every existing ClickHouse key stays byte-identical.
  `PEERDB_SOURCE_ID = 0` (`read-peerdb-insights.ts`) — PeerDB is a single
  flow-api deployment, so v1 has exactly one source; the offset still leaves the
  door open for per-connection sources without a migration. The **dismissal key**
  is separately engine-prefixed: `insightKey(sourceId, …, 'peerdb')` →
  `peerdb:<id>:<category>:<metric>:<title>`. Covered by `insights.test.ts`.
- **Throttle + cron**: `generatePeerDBInsights` applies the same
  `INSIGHTS_MIN_REGEN_INTERVAL_MS` floor as the other two generators (skip and
  return the stored set unless `force`), then collect → enrich (the shared
  `enrichInsights` LLM path) → record. `runPeerDBInsightSweep`
  (`src/lib/health/server-sweep.ts`) calls it after the ClickHouse and Postgres
  loops, gated on `getPeerDBConfig() !== null` and wrapped so a failure only
  logs — an unconfigured or unreachable PeerDB contributes 0 insights.
- **Manual + read**: `GET/POST /api/v1/insights/peerdb` — read and generate
  collapsed onto ONE route, with no `?pg=`-style source parameter (one
  deployment). Fail-graceful: with PeerDB unconfigured it answers 200 with an
  empty, `unavailable`-flagged payload rather than an error, so a UI probe
  degrades to "nothing to show". POST self-enforces the same write gate as the
  ClickHouse generate route.

### PeerDB findings are page-local (deliberate, not an omission)

**Decision: PeerDB findings render on `/peerdb` only. The global strip, board,
and popover stay ClickHouse-engine only.**

- `PeerDBInsightsPanel` (`components/peerdb/peerdb-insights-panel.tsx`) is
  mounted at the top of `/peerdb` (`routes/(peerdb)/peerdb/index.tsx`) and
  reads `usePeerDBInsights` (`lib/query/use-peerdb-insights.ts`). It renders
  nothing at all until there is an insight (or one is generating), and nothing
  when PeerDB is unconfigured — the `/peerdb` page's own not-configured state
  already says that, so an empty box there is noise. Deliberately minimal: no
  filter tabs, no settings gear, no board.
- The three shared surfaces (`insights-strip.tsx` / `insights-panel.tsx` /
  `insights-popover.tsx`) all take `useInsights(hostId)`, which reads
  `/api/v1/insights` and resolves against a **ClickHouse `hostId`**. A PeerDB
  finding has no ClickHouse host: it lives under `peerdbInsightStoreHostId(0)`
  and belongs to the env-wide PeerDB deployment, not to any entry in the host
  list. Folding it into the global surfaces would put it under a `?host=`
  dimension that does not apply, and `/insights` would try to explain it with
  charts (see the `insightChartNames` guard in **Gotchas**). On `/peerdb` the
  routing dimension *is* the PeerDB connection, so the card lands where the
  operator already is.
- That is also why the panel reuses the shared `InsightCard` and
  `severity-meta` (styling parity with the ClickHouse board) but not the
  board's chart layer.
- The Postgres panel follows the same page-local rule on
  `/postgres/queries`; PeerDB is the second instance of that pattern, not a
  new one.

### Two action-derivation switches

The findings store keeps scalars only, so the card **action is re-derived on
read** — it is never persisted. That makes a metric's action link a function of
the read path, not of the collector, and an unmatched metric **silently loses its
link after a reload**: the card renders correctly in the immediate `generate()`
response (which still carries the in-memory `action`) and comes back link-less
from the store on the next read.

There are two switches because there are two read paths, and **a metric belongs
to the switch its own source is read by — and only that one**:

- `deriveAction` (`read-insights.ts`) is the read path for **ClickHouse** metrics.
  It is private, has one call site in `toCard`, and `readInsights` reads by a
  real `hostId` — so a `peerdb_` metric can never reach it.
- `derivePeerDBAction` (`read-peerdb-insights.ts`) is the **only** switch a new
  **PeerDB** metric needs. It is the read path `readPeerDBInsights` — and so
  every PeerDB card — actually travels, so a new PeerDB metric with no case here
  renders fine on first generation and loses its link on the next read. It
  matches per-mirror metrics by **prefix**, not by enumerating suffixes: a
  per-mirror metric is `peerdb_mirror_errors:<flow-slug>` and the store no
  longer knows the flow list. Actions deep-link to the existing `/peerdb` and
  `/peerdb/peers` pages, not new routes.
- A `peerdb_` case in `deriveAction` is dead code, not a guard. PeerDB rows are
  persisted under `peerdbInsightStoreHostId()` and read back only by
  `readPeerDBInsights`, so no `peerdb_` branch in `deriveAction` can ever fire
  (#3474).
- The same discipline applies to a future source: it brings its own
  `derive*Action` read-path switch, and its own metrics go there.

### Identity determinism (applies to PeerDB too)

Stable identity is load-bearing for **every** source, not just the
schema-optimization collector above: the dismissal key embeds `metric` and
`title`, so a run-varying value in either re-keys the card on the next sweep
and resurrects the user's dismissal. `checkPartsPressure`
(`operational-checks.ts`, `parts_pressure`) is the ClickHouse precedent;
PeerDB makes it sharper because the interesting value *is* a count or a MiB
reading.

- Fleet-wide PeerDB cards use a **count-free** title (`PeerDB: mirrors are
  failing`, not `PeerDB: 3 mirrors failed`) and carry the number in `value` /
  `detail`.
- Per-mirror cards put the flow slug in the **metric**
  (`peerdb_mirror_errors:<slug>`) so each mirror gets its own card and its own
  stable dismissal, with the flow name in the title and the count in `value`.
- Proved by `peerdb-checks.test.ts` →
  `describe('identity determinism (the dismissal survives regeneration)')`: the
  key holds while the count changes, the failing title is exactly
  `'PeerDB: mirrors are failing'` and carries no digit, every card title is
  count-free and `"PeerDB: "`-prefixed (per-mirror ones excepted only for the
  flow name), and two mirrors produce two distinct metrics so both keep their own
  dismissal.

### Health Summary (same issue, sibling surface)

`#3439` also gave `/health` a PeerDB group. `PEERDB_HEALTH_DEFS`
(`components/health/peerdb-cards.tsx`) declares three items — `peerdb-fleet`,
`peerdb-slot-lag`, `peerdb-mirror-failures` — and `computePeerDBHealth`
(`lib/health/health-status.ts`) supplies the status for all three from one
snapshot (the worst of failed / terminated / slot-lag), so a climbing slot lag
can promote its own card while the fleet card stays green.
`health-grid.tsx` appends the group only when `peerDBConfigured` (`PEERDB_API_URL`
set); otherwise the whole group is **absent**, not a row of green zeros for a
product this deployment does not run. The data arrives over PeerDB REST via
`usePeerDBMetrics`, not through the ClickHouse chart registry, so the group
carries its own `computeX` and an empty `chartName` rather than a fake SQL rule.

## Generation triggers

- **Cron**: `runHealthSweep()` (`src/lib/health/server-sweep.ts`) calls
  `generateInsights(hostId)` per host on the existing 5-minute Cloudflare trigger
  (`api/cron/health-sweep`). No new trigger.
- **Manual**: `POST /api/v1/insights/generate?host=<id>` (the panel's Refresh
  button), optionally carrying the user's config (see below).

**Server-side regeneration throttle.** The collect pipeline runs ~10 ClickHouse
scans per call, so `generateInsights` enforces a min-interval floor
(`INSIGHTS_MIN_REGEN_INTERVAL_MS`, 5 min): when the store already holds an
`ai-insight` finding newer than the window it returns the stored set (via
`readInsights`) instead of re-scanning. Auto-generate-on-mount and the cron sweep
are throttled; the explicit manual Refresh passes `force=true` (query param →
`generateInsights(..., { force })`) to bypass it for an immediate refresh. Client
wiring: `generateParamsFromSettings(host, settings, { force })`, and the
`useInsights` `generateMutation` takes `{ force }` (auto effect `false`, exposed
`generate()`/preview `true`).

## Configuration (per-user)

Insight generation is configurable per-user, persisted client-side (localStorage,
like dismissals + the agent model picker). All overrides are **optional and
validated server-side** — omitting them reproduces the original behavior.

- **Settings model** — `src/lib/insights/settings.ts` (`InsightsSettings`:
  `model` | `promptStyle` | `enrich` | `window`), pure/isomorphic with
  `sanitizeInsightsSettings` + `generateParamsFromSettings`. Hook:
  `src/lib/query/use-insights-settings.ts` (localStorage + `CustomEvent`/`storage`
  broadcast so the panel, settings page, and header popover stay in sync).
- **Prompt styles** — `src/lib/insights/prompts.ts`: `concise` (default) /
  `detailed` / `beginner`, each a distinct enrichment system prompt. The
  deterministic baseline copy is unchanged.
- **Model override** — validated server-side in
  `src/lib/insights/resolve-model.ts` against the *configured* registry
  (`getModelRegistry()` + `isProviderConfigured`); an unknown/unconfigured id
  falls back to the deployment default (`DEFAULT_MODEL`).
- **Generate API params** — `POST /api/v1/insights/generate` accepts
  `enrich` (`false` skips LLM), `model` (`provider:model`), `promptStyle`, and
  `force` (`true` bypasses the regeneration throttle). The read endpoint
  (`GET /api/v1/insights`) takes `since` = the chosen window.
- `enrichInsights(candidates, { model, promptStyle })` /
  `generateInsights(hostId, { enrich, model, promptStyle, force })` thread the
  overrides.

## Settings page

- `/insights-settings` (`src/routes/(dashboard)/insights-settings.tsx`) renders
  `InsightsSettingsForm` (`src/components/insights/insights-settings-form.tsx`):
  enrichment toggle, model picker (configured providers from
  `/api/v1/agents/models`), prompt style, lookback window, reset-to-defaults.
- Reachable from the overview panel's settings gear and the header popover.

## Read + dismissal

- `GET /api/v1/insights?host=<id>` reads `ai-insight` findings, **de-duplicates by
  stable key** (newest wins) and bounds to a recent window (`6 HOUR` default) so
  resolved issues age out.
- **Stable key** = `host:category:metric:title` (`insightKey()`). Dismissals key
  off this so re-generation does not resurrect a dismissed card.
- **Dismissal is per-user in localStorage** (`dismissed-ai-insights`), mirroring
  `lib/notifications/dismissed-notifications.ts`. See
  `src/lib/insights/dismissed-insights.ts` and the `useInsights` hook
  (`src/lib/query/use-insights.ts`).

## UI

Two tailored surfaces share the same `useInsights` hook (so counts + dismissals
stay in sync) and the same card + severity styling. Both are
**ClickHouse-engine-scoped** — the other sources are deliberately page-local, and
documented in their own sections above (see **PeerDB findings are page-local**):

- `src/components/insights/insights-strip.tsx` — **overview `/overview` strip**:
  every active insight in a **single horizontally-scrollable row** with the
  scrollbar hidden (`scrollbar-hide`). On overflow a chevron button + edge fade
  appear per scrollable side and page by ~one viewport (`scrollBy`); overflow is
  re-measured on scroll, container resize, and card-count change. Header carries
  a **"View all insights"** deep link to `/insights`.
- `src/components/insights/insights-panel.tsx` — **`/insights` page board**:
  insights **grouped by category** (Anomalies / Performance / Storage /
  Reliability / Optimization, extensible to Queries / Cost) with section headers,
  a segmented
  **filter row** (All · a tinted **"Needs attention"** tab for critical+warning ·
  one tab per present category), and header severity count badges.
- `src/components/insights/insight-card.tsx` — shadcn `Card` wrapper (never edits
  `components/ui/`), a **severity-toned left-accent border**, dismiss `X`, and a
  derived action link (e.g. View tables / Open running queries / Ask the agent).
- `src/components/insights/severity-meta.ts` — **single source** for severity
  label (`info` renders as **"Notice"**), icon, and token classes, shared by the
  card, strip, and board so they never drift.
- `src/components/insights/insights-empty-cta.tsx` — shared slim "Generate
  insights" CTA rendered by both the strip and the board when a host has none.
- `src/components/insights/insights-popover.tsx` — **global header popover**
  (mirrors `NotificationsPopover`), mounted in `header-actions.tsx` so insights
  surface on every page: severity-toned count badge, top insights with deep
  links, Refresh, and footer links to the overview panel + settings page. Reuses
  `useInsights`, so counts/dismissals stay in sync with the panel.

## Gotchas

- The findings table stores only scalars — the card **action is re-derived** from
  `metric`/`category` on read, so rich per-table prompts only appear in the
  immediate `generate()` response. **Each source re-derives the action on its
  own read path** — `deriveAction` (`read-insights.ts`) for ClickHouse,
  `derivePeerDBAction` (`read-peerdb-insights.ts`) for PeerDB — so a new metric
  with no case in the right switch silently loses its link after a reload. See
  **Two action-derivation switches** above.
- **`insightChartNames` short-circuits non-ClickHouse metrics.**
  `lib/insights/insight-charts.ts` returns `[]` for a `pg_`- or
  `peerdb_`-prefixed metric:
  the chart registry holds only ClickHouse charts, so without the prefix guard a
  `peerdb_` finding would fall through to `CATEGORY_CHARTS` and render unrelated
  ClickHouse query charts underneath a PeerDB card.
  `lib/insights/insight-charts.test.ts`
  (`'non-ClickHouse engines never get a ClickHouse chart (#3439)'`) locks it in —
  a new non-ClickHouse source must be added to **both** the guard and that test
  list.
- Health-sweep findings are **not** written to the findings table (only webhook
  dispatch), so reading `source='ai-insight'` returns exactly engine output.
- Tests: `src/lib/insights/insights.test.ts` (pure key + dismissal logic; shims
  `window`/`localStorage`), plus the per-source suites —
  `operational-checks.test.ts`, `postgres-checks.test.ts`, `peerdb-checks.test.ts`
  (pure classifiers, no I/O), `peerdb-collectors.test.ts` (stub
  `PeerDBSnapshotReader`), and `insight-charts.test.ts` (same dir). Run with
  `bun test src/lib/insights`. Note the operational classifiers are tested in
  `operational-checks.test.ts` (pure, no
  I/O) rather than `collectors.test.ts`, which is poisoned in the full-suite run
  by a process-global `mock.module('./collectors')` in
  `generate-insights.throttle.test.ts` (pre-existing; those 6 collector tests
  pass in isolation).

## TTL rewrite amplification (#4069 slice 1)

`collectTtlRewriteAmplification` (`ttl-rewrite-collector.ts`, called from
`collectStorage`) flags a table whose TTL is expensive to apply: a row TTL on a
coarse `PARTITION BY` (typically `toYYYYMM(ts)`) without `ttl_only_drop_parts`
makes ClickHouse rewrite the oldest partition's parts every
`merge_with_ttl_timeout`. Evidence is `system.part_log` for this host
(per replica) over 14 days: `TTLDeleteMerge` `read_bytes` >= 1 TiB and >= 4x the
`NewPart` bytes ingested. Pure thresholds and row mapping are in
`ttl-rewrite-classifier.ts`.

- **Reads `system.tables.engine_full`**, not `create_table_query`: the TTL clause
  and `SETTINGS ttl_only_drop_parts = N` are regexed out of it (a heuristic), with
  `system.merge_tree_settings` as the fallback default. `ttl_only_drop_parts = 1`
  is excluded in SQL and again in the classifier.
- **Partition-key exemption is about granularity, not mere containment.** A key
  that holds the TTL column at day granularity or finer (`toDate(ts)`,
  `toYYYYMMDD(ts)`) is excluded; `toYYYYMM(ts)` / `toMonday(ts)` on the TTL
  column is exactly the problem case and stays flagged.
- **One warning, never critical**, for the table with the most TTL bytes read.
  Identity: the table is in the **metric** (`ttl_rewrite:<db.table>`), the title
  is count-free, bytes and ratio live in `detail`/`value`, so the dismissal
  survives byte-count changes. `deriveAction` matches the `ttl_rewrite:` prefix
  (a literal case is impossible, and the metric scan in
  `read-insights.derive-action.test.ts` only sees literals).
- Recommend-only: the detail names `ttl_only_drop_parts = 1` and a finer
  partition key as options to evaluate, and says it is a cost issue, not an
  outage. No DDL is emitted. Fails open to `[]` on any error (no part_log, old
  server without `merge_reason`).
- Tests: `ttl-rewrite.test.ts`. The SQL was also run on `clickhouse local`
  26.5 against fake `part_log`/`tables` Memory tables.
- Still open in #4069: the `/ttl-partition-health` section and the agent
  tool. (Retention forecast and OPTIMIZE-on-unchanged-data are the next
  sections.)

## Per-table retention forecast (#4069 slice 2)

`collectRetentionForecast` (`retention-forecast-collector.ts`, called from
`collectStorage`; pure thresholds and mapping in
`retention-forecast-classifier.ts`) flags the one table that accounts for
>= 50% of the ingest on this host, holds >= 100 GiB on disk, and has no TTL
(`engine_full` has no ` TTL `). One `info` insight at most.

- **Evidence.** `system.part_log` `NewPart` `size_in_bytes` over the last 30
  days (per replica; `part_log` retention may hold less, so the detail uses the
  days actually present). Share is over all non-system tables, computed before
  the 50% filter. Current size and age buckets come from active
  `system.parts`.
- **Freed bytes are conservative.** "Older than 12/24/36 months" sums parts
  whose newest row (`max_date`) is that old, so a part that still holds recent
  rows is never counted. These are bytes on disk, not a recommendation.
- **Identity.** Table in the metric (`retention_forecast:<db.table>`), count-free
  title, numbers only in `detail`/`value`: the dismissal survives changing
  numbers. `deriveAction` matches the prefix (links to `/ttl-partition-health`).
- **Recommend-only.** No DDL, never says "safe to drop"; the detail says it is a
  forecast from the part_log window and the decision belongs to the table owner.
  Fails open to `[]` (no part_log, missing column, any error). Not fed into
  `disk-time-to-full` (a separate design call).
- **SQL portability.** Plain CTEs, a window `sum() OVER ()`, no lambda aliases in
  `WITH` (a query config that used one broke main under `enable_analyzer=0`).
  Run on `clickhouse local` 26.5 over fake `part_log`/`parts`/`tables` tables
  under both `enable_analyzer=0` and `=1`: identical rows for a dominant no-TTL
  table (flagged), a dominant table with a TTL, a small dominant table, and a
  45% share table (none flagged).
- Tests: `retention-forecast.test.ts`.

## OPTIMIZE FINAL on unchanged data (#4069 slice 3)

`collectOptimizeUnchanged` (`optimize-unchanged-collector.ts`, called from
`collectStorage`; pure thresholds and mapping in
`optimize-unchanged-classifier.ts`) flags a table on which `OPTIMIZE TABLE ...
FINAL` ran at least 3 times in the last 14 days with no new data inserted
between the runs. One `info` insight per flagged table, capped at the three with the most unchanged runs (the SQL returns at most 20 tables; the cap keeps a cluster of cron-driven tables from flooding the feed). The
maintainer approved the defaults on #4069: single node first (no
`clusterAllReplicas`, so a replicated table is judged by this host's logs only
and the detail says "single replica"), "unchanged" means zero `NewPart` events
between consecutive runs, threshold 3 runs.

- **What OPTIMIZE looks like in `query_log` (observed on ClickHouse 26.5, a
  scratch server with `query_log` and `part_log` enabled).** One
  `type = 'QueryFinish'` row per statement with `query_kind = 'Optimize'`.
  `tables` is always `['db.table']` and `databases` is `['db']`, even after
  `USE db` and when the statement names the table without a database. The text
  is in `query`, so FINAL is told from plain `OPTIMIZE TABLE t` by the text
  (plain OPTIMIZE has the same `query_kind`). A statement with trailing
  `SETTINGS ...` keeps its `FINAL`.
- **What it looks like in `part_log`.** Each `OPTIMIZE ... FINAL` produces
  `MergePartsStart` + `MergeParts` with `merge_reason = 'RegularMerge'` (a
  one-part table is still rewritten). Inserts are `NewPart` with
  `merge_reason = 'NotAMerge'`. So `NewPart` is exactly "new data", and the
  merges an OPTIMIZE causes never count as new data.
- **Microsecond ordering.** A run and the insert before it commonly share the
  same second (all of the test statements above landed in one second), so the
  SQL orders by `event_time_microseconds`, not `event_time`.
- **How the SQL decides.** `query_log` runs and `part_log` `NewPart` rows are
  merged into one stream per table; a running count of new parts is read at each
  run, and a run is unchanged when it equals the count at the previous run. The
  first run has nothing to compare against and never counts. No range join.
  The SQL returns only `runs` and `unchanged_runs` per table (bounded), the
  classifier applies the same threshold again (it clamps `unchanged_runs` to
  `runs - 1`).
- **Identity.** Table in the metric (`optimize_unchanged:<db.table>`),
  count-free title, numbers only in `detail`/`value`. `deriveAction` matches the
  prefix (links to `/merges`).
- **Recommend-only.** No DDL, never says "safe"; the detail suggests reviewing
  whether the schedule is needed. Fails open to `[]` (no query_log or part_log,
  missing column, any error).
- **SQL portability.** CTEs and window functions, no lambda aliases in `WITH`.
  Two traps found while verifying: under `enable_analyzer=0` a literal aliased
  `kind` collided with the window sum (renamed to `is_run`/`is_part`), and
  `any(x) AS x` inside another aggregate is illegal under the analyzer (group by
  the column instead). Verified on the real server's `system.query_log` /
  `system.part_log` and over fake Memory tables, under both analyzer modes with
  identical output: a table optimised 4 times with no inserts between (flagged),
  4 times with an insert before each (not), 2 runs (not), 4 runs 20 days ago
  (not), plain OPTIMIZE without FINAL (not), failed runs (not), merges between
  runs (still flagged), and a same-second burst (flagged).
- **Known limit.** A table literally named `final` (`OPTIMIZE TABLE final`)
  matches the FINAL pattern; a `NewPart` on another replica is invisible here.
- Tests: `optimize-unchanged.test.ts`.

## Unread tables and unused projections (#4067 slices 4 and 5)

`collectUsage` (`usage-collector.ts`, called from `collectStorage`; pure
thresholds and mapping in `usage-classifier.ts`; SQL builders in
`usage-findings-sql.ts`, shared with the `get_usage_findings` agent tool) emits
at most two `info` cards: the single largest unread table and the single
largest unused projection. Unread columns are deliberately not collected: they
are per table and misleading without a table choice (the tool serves them).

- **Gates.** Size >= 10 GiB (tables and projections, same constant) and a log
  window of >= 7 days (`dateDiff('day', min(event_date), today())`). A shorter
  or empty log returns nothing: a short log proves nothing. `minOrNull`, not
  `min`, so an empty log gives a NULL window and not 1970-01-01 (the
  `unused-tables` config still uses `min`; that only affects its displayed
  `log_window_start`).
- **Wording.** The detail states: unread in the query_log window on THIS replica
  only, the window start (`min(event_date)`) and its length so short retention
  is visible, the size, and that unread is not the same as unused. It never
  emits DDL and never says "safe to drop"; tests assert both.
- **Identity.** Object in the metric (`usage:unread_table:<db.table>`,
  `usage:unused_projection:<db.table.projection>`), count-free titles, numbers
  and window only in `detail`/`value`, so the dismissal key survives changing
  sizes and window. `deriveAction` matches both prefixes (links to
  `/unused-tables` and `/unused-projections`).
- **Two queries, each fails open.** A server without `system.projections` (or
  `projection_parts`) still reports its unread table, and the reverse. Read-only,
  `event_date` bound, LIMIT, `max_execution_time` client setting (the #4082
  constant), `LOCAL_DATABASES_FILTER` so remote-engine databases are never
  scanned.
- **SQL portability.** Plain CTEs and scalar subqueries; no lambda in `WITH`
  (#4084), no backslash (`[[:space:]]` in the column query). Run on
  `clickhouse local` over fake `query_log`/`tables`/`projections`/
  `projection_parts`/`columns` Memory tables under `enable_analyzer=0` and `=1`:
  identical rows. A large unread table flagged; a table read through backticked
  names not; a 400-day-old read ignored; failed SELECTs and INSERTs do not count
  as reads; a used projection and inactive projection parts excluded; a 2-day
  log gives `log_window_days = 2` (classifier returns nothing); an empty log
  gives NULLs.
- **Agent tool.** `get_usage_findings` (`tools/usage-tools.ts`, category
  `advisor`) returns the three lists with `window`, `scope`, `caveats` and a
  `warning` when the log is under 7 days, so the model cannot present a short
  log as a finding. It runs through `readOnlyQuery`, so it also works on a
  user's own connection (not in `CONNECTION_UNSUPPORTED_TOOLS`: it has no
  `checkTableExists` dependency).
- Tests: `usage.test.ts`, `tools/__tests__/usage-tools.test.ts`.

## Follow-ups

- **Schema-optimization suggestions — done.** The advisor engine is now wired
  into the collect pipeline as the `optimization` category (see the
  schema-optimization collector above), reusing `analyzeQuery` rather than
  reimplementing schema analysis.
- **Predictive parts pressure — done.** `checkPartsPressure`
  (`operational-checks.ts`, metric `parts_pressure`, category `storage`) projects
  when the worst partition will hit `parts_to_throw_insert` from the net
  part-growth rate in `system.part_log` (warns inside 6h, critical inside 1h or
  already delaying), degrading to a fill-percent-only finding when part_log is
  off. The projection math + SQL builders live in `lib/health/parts-pressure.ts`
  and are shared with the `/health` card (`parts-pressure`) and the
  `parts-pressure` alert rule.
- **More detectors.** The operational collectors are a starter set. Natural next
  detectors (each still a cheap single system-table read + a pure classifier in
  `operational-checks.ts`): long-running merges (`system.merges`), growing
  `system.replication_queue`, dropped connections / rejected inserts, and
  `cost`-category signals (e.g. cold-storage candidates). Each new metric needs a
  matching `deriveAction` case and a category in the board's `CATEGORY_META`.
