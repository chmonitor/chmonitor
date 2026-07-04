---
id: ai-insights
title: AI Insights Engine
type: spec
status: active
updated: 2026-07-04
tags:
  - insights
  - findings
  - overview
  - ai
  - dismissal
related:
  - mcp-server
  - query-config-format
  - conventions
  - agentstate-conversation-store
  - agent-conversation-storage
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
  porting the SQL/severity heuristics from the agent's `anomaly-tools.ts` /
  `insights-tools.ts`. They **never throw** — any failure yields `[]` so the
  feature degrades on read-only clusters or missing system tables.
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
- **Operational collectors** (`collectOperational` in `collectors.ts`) add cheap
  point-in-time checks across categories — detached parts (`storage`), stuck /
  failing mutations + FAILED dictionaries (`reliability`), and the longest
  running live query (`performance`) — each a single count/aggregate on a small
  system table. Their **classification is split into pure functions** in
  `operational-checks.ts` (thresholds → `InsightCandidate | null`), mirroring the
  anomaly collector's `decideSeverity`, so severity logic is unit-tested without
  ClickHouse I/O (`operational-checks.test.ts`). Adding a metric here **must** be
  paired with a `deriveAction` case in `read-insights.ts` — the findings store
  keeps scalars only, so the action link is re-derived from `metric`/`category`
  on every read; an unmatched metric silently loses its link after a reload.
- **Enrichment is optional.** When a provider key resolves
  (`isProviderConfigured(resolveProvider(DEFAULT_MODEL).providerId)`), candidates
  pass through one `generateObject` call that tightens wording. With no key (or
  on any error) candidates are returned unchanged — the "if available" half.
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
stay in sync) and the same card + severity styling:

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
  `metric`/`category` on read (`deriveAction` in `read-insights.ts`), so rich
  per-table prompts only appear in the immediate `generate()` response.
- Health-sweep findings are **not** written to the findings table (only webhook
  dispatch), so reading `source='ai-insight'` returns exactly engine output.
- Tests: `src/lib/insights/insights.test.ts` (pure key + dismissal logic; shims
  `window`/`localStorage`). Run with `bun test src/lib/insights`. Note the
  operational classifiers are tested in `operational-checks.test.ts` (pure, no
  I/O) rather than `collectors.test.ts`, which is poisoned in the full-suite run
  by a process-global `mock.module('./collectors')` in
  `generate-insights.throttle.test.ts` (pre-existing; those 6 collector tests
  pass in isolation).

## Follow-ups

- **Schema-optimization suggestions — done.** The advisor engine is now wired
  into the collect pipeline as the `optimization` category (see the
  schema-optimization collector above), reusing `analyzeQuery` rather than
  reimplementing schema analysis.
- **More detectors.** The operational collectors are a starter set. Natural next
  detectors (each still a cheap single system-table read + a pure classifier in
  `operational-checks.ts`): long-running merges (`system.merges`), high
  `parts_to_throw_insert` pressure, growing `system.replication_queue`, dropped
  connections / rejected inserts, and `cost`-category signals (e.g. cold-storage
  candidates). Each new metric needs a matching `deriveAction` case and a
  category in the board's `CATEGORY_META`.
