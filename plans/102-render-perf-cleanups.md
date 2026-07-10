# Plan 102: Small render/request perf cleanups (merged-hosts memo, key double-stringify, topology parallelism)

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/lib/swr/use-merged-hosts.ts apps/dashboard/src/lib/query apps/dashboard/src/routes/api/v1/cluster-topology.ts`

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/72 (touches the same queryKey code — land 72 first to avoid conflicts)
- **Category**: perf
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2519

## Why this matters

Three small, verified inefficiencies:

1. `useMergedHosts` rebuilds its merged array (fresh `.map` spreads, new object
   identities) on EVERY render, and it is called by every chart and table hook
   — a dense page instantiates it dozens of times per poll cycle. Not a fetch
   storm (TanStack Query dedupes), but avoidable allocation churn and an
   identity footgun for memoizing consumers.
2. `use-chart-data.ts` / `use-table-data.ts` JSON-stringify their params twice
   per render (once memoized for the URL, once inline in the queryKey).
3. The cluster-topology route serially awaits its structural query before
   firing two independent Keeper queries that don't consume its result — one
   wasted ClickHouse round-trip per topology page load.

## Current state

- `apps/dashboard/src/lib/swr/use-merged-hosts.ts:73-106` — `mergedHosts`
  built inline each render from `envHosts`/`connections`/`dbConnections` +
  `cloudMode`/`isSignedIn` flags; no `useMemo`.
- `apps/dashboard/src/lib/query/use-chart-data.ts` — `paramsKey =
  JSON.stringify(params)` (~line 80) then `JSON.stringify(params ?? null)`
  inline in the queryKey (~line 100). Same in `use-table-data.ts` (~line 69).
  NOTE: plan 72 replaces these inline keys with a shared factory — implement
  this item INSIDE that factory (single stringify), or skip if 72 already did.
- `apps/dashboard/src/routes/api/v1/cluster-topology.ts` — structural fetch
  awaited (~line 142); independent Keeper `Promise.all` at ~lines 181-193 uses
  static queryConfigs (no input from the structural result); the true
  dependent fan-out is at ~line 209.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd apps/dashboard && bun test src/lib/swr src/lib/query src/routes/api/v1` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**: the three files above (+ shared key factory from plan 72).

**Out of scope**: TanStack Query config (staleTime etc.); topology layout
logic; adding new memoization elsewhere.

## Git workflow

- Branch: `advisor/102-render-perf-cleanups`
- Commit: `perf(dashboard): memoize merged hosts, dedupe key serialization, parallelize topology queries`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Memoize `useMergedHosts`
Wrap the array construction in `useMemo` keyed on the source arrays and flags
(exact deps: `envHosts, connections, dbConnections, dbFeatureEnabled, cloudMode,
isSignedIn, envSource` — read the full hook to catch all inputs). Ensure the
return object is also memoized if consumers destructure identity-sensitively.
**Verify**: `bun test src/lib/swr` pass; build green.

### Step 2: Single stringify per render
In the shared key factory (from plan 72): accept the pre-computed
`paramsKey`, don't re-stringify. If plan 72 isn't merged yet, STOP for this
step and do steps 1+3 only (note in README).
**Verify**: `rg -c "JSON.stringify" apps/dashboard/src/lib/query/use-chart-data.ts` → 1.

### Step 3: Parallelize topology
Start the structural fetch and the Keeper `Promise.all` together
(`Promise.all([structuralPromise, keeperPromise])`), keeping the
`clusterRows`-dependent fan-out after. Confirm by reading lines 130-210 that
the Keeper queries take no structural input (they use static configs).
**Verify**: `bun test src/routes/api/v1` pass (topology tests, if present);
build green.

## Done criteria

- [ ] `useMergedHosts` returns stable identities across unrelated re-renders (add a small identity test if the hook-test harness exists)
- [ ] One serialization per params per render
- [ ] Topology fires structural+keeper concurrently
- [ ] Build + tests green; `plans/README.md` updated

## STOP conditions

- A consumer depends on `useMergedHosts` returning fresh identities (unlikely
  but check hosts-switcher tests) — report.
- Keeper queries turn out to read the structural result (drift) — skip step 3.

## Maintenance notes

- Identity stability now matters for `mergedHosts` consumers; note in the hook
  docblock.
