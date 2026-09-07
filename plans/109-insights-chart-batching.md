# Plan 109: Batch the /queries/insights page's 15 chart fetches into one grouped request

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- 'apps/dashboard/src/routes/(dashboard)/queries/insights.tsx' apps/dashboard/src/lib/api/chart-batch.ts apps/dashboard/src/routes/\(dashboard\)/-insights/`
> On mismatch, re-read live files.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3304

## Why this matters

`/queries/insights` (shipped 2026-08-18) mounts ~15 factory chart components,
each calling `useChartData` independently → 15 separate Worker→ClickHouse
round-trips per page load, repeated by each chart's own refetch timer while the
tab sits open (~900 extra queries/hour/idle-tab at default intervals). The repo
already solved exactly this for the insights-stats page with the chart-batch
endpoint + `ChartGroupingProvider`, but only ONE grouping is registered today
(`CHART_GROUPINGS` has a single entry, `lib/api/chart-batch.ts:44`). This page
predates-or-missed that infra.

## Current state

- Page: `apps/dashboard/src/routes/(dashboard)/queries/insights.tsx:33–67` —
  15 factory tiles (`createAreaChart`/`createBarChart` from
  `components/charts/factory/`) covering QPS, latency percentiles, operations,
  rows, cache-hit, errors, memory, throughput, top-users, distributions, and
  two drill-downs.
- Batching infra: `apps/dashboard/src/lib/api/chart-batch.ts` —
  `POST /api/v1/charts/batch`; `export const CHART_GROUPINGS = Object.freeze({ ... })`
  currently one key (`insights-stats`). Consumer hook:
  `lib/query/use-chart-grouping.tsx` (`useGroupedChartData`),
  provider component `ChartGroupingProvider`.
- Exemplar page to copy structurally: whichever route hosts insights-stats
  (`grep -rn "ChartGroupingProvider" apps/dashboard/src/routes | head`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm run type-check` (from apps/dashboard) | exit 0 |
| Unit tests | `cd apps/dashboard && bun test src/lib/api/__tests__/chart-batch.test.ts --isolate` (if exists; else full `bun test src/lib/api --isolate`) | pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**:
- `apps/dashboard/src/lib/api/chart-batch.ts` (add grouping)
- `apps/dashboard/src/routes/(dashboard)/queries/insights.tsx` (wrap in provider, swap tiles to grouped consumption)
- Tests for the new grouping registration

**Out of scope**:
- The batch endpoint route handler itself (`routes/api/v1/charts/batch.ts`)
- Changing any of the 15 charts' SQL/configs or visual design
- Other pages

## Git workflow

- Branch: `advisor/109-insights-chart-batching`
- Commit: `perf(queries): batch insights-page charts through the group endpoint`

## Steps

### Step 1: Register the grouping

Add a second entry to `CHART_GROUPINGS`, e.g.
`'query-insights-overview': [ ...the 15 chart names exactly as their configs register them... ]`.
Names must match what each factory tile passes as its chart name — extract them
by reading the page file; do not guess.

### Step 2: Convert the page

Wrap the page content in `ChartGroupingProvider grouping="query-insights-overview"`
and convert each tile to consume via `useGroupedChartData` following the
insights-stats exemplar. Preserve each chart's interval/params so `paramsKey`
serialization stays correct (percentile overlays etc.). If a tile's params are
dynamic per-mount and incompatible with grouping, leave THAT tile ungrouped and
note it.

### Step 3: Test

Add/extend a unit test asserting the new grouping exists and lists 15 valid
registered chart names (pattern: existing test for `insights-stats` grouping if
present, else assert against the chart registry).

## Done criteria

- [ ] `grep -c "useChartData(" apps/dashboard/src/routes/(dashboard)/queries/insights.tsx` → 0 direct calls outside provider-managed tiles
- [ ] Network behavior (manual dev-server check or existing integration test): page load issues ONE `/api/v1/charts/batch` request instead of 15 chart requests
- [ ] type-check + build green; unit tests green

## STOP conditions

- The 15 tiles turn out to have heterogeneous params making grouped keys unstable → group only the homogeneous subset (≥10) and report the rest.
- ChartGroupingProvider API differs materially from this description → adapt following the live exemplar; if fundamentally different, STOP.

## Maintenance notes

- New pages with ≥4 auto-refreshing factory charts should register a grouping — consider noting this convention in docs/knowledge/product-design.md (out of scope here).
- Watch bundle-size workflow stays green (no runtime additions expected).
