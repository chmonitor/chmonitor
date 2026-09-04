# Plan 114: Parallelize insights-collector probes and cap the schema-optimization fan-out

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/lib/insights/collectors.ts`
> On mismatch, re-read live files.

## Status

- **Priority**: P2 (perf) / P3 guard (fan-out cap)
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3309

## Why this matters

`POST /api/v1/insights/generate` serializes ~8 Worker→ClickHouse round-trips
INSIDE its collector groups: `collectOperational` awaits detached_parts →
mutations → processes → dictionaries one-by-one (`collectors.ts:476–525`);
`collectReliability` runs its two `system.replicas` probes serially (:425–450);
`collectStorage`'s parts-scan + compression-scan likewise (:358–420). Only the
five top-level groups are parallel today (:658–663). This stretches both the UI
"generating…" state and the weekly-report cron's wall-clock.

Separately, `collectSchemaOptimizations` (:612–631) maps candidate slow-query
patterns through the FULL advisor analyzeQuery pipeline (~5+ ClickHouse queries
each) via one `Promise.all` with no visible candidate cap — a worst-case load
spike against the exact cluster being monitored if the candidate query returns
many rows.

## Current state

Pattern in each collector (excerpt shape):

```ts
const parts = await probe(...)     // e.g. detached_parts
const muts  = await probe(...)     // mutations
const procs = await probe(...)     // processes
```

Top level already does:

```ts
await Promise.all([...groups])   // :658–663
```

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Insights tests | `cd apps/dashboard && bun test src/lib/insights --isolate` | pass |
| Typecheck | `pnpm run type-check` | exit 0 |
| Full unit | `pnpm run test:unit` | pass |

## Scope

**In scope**:
- `apps/dashboard/src/lib/insights/collectors.ts`
- Its test files

**Out of scope**:
- weekly-report.ts, read-insights.ts, types.ts
- Advisor engines (plan 110 covers those)
- Any SQL text changes

## Git workflow

- Branch: `advisor/114-insights-probe-fanout`
- Commit: `perf(insights): parallelize intra-group probes and cap advisor fan-out`

## Steps

1. In `collectOperational`, `collectReliability`, and `collectStorage`, convert
   sequential probes to `Promise.allSettled([...])` over arrays of thunks,
   preserving per-probe error degradation EXACTLY (each probe currently
   try/catches to null/severity-0 — keep that per-thunk; allSettled just joins
   them). Preserve result-order independence: assemble findings from settled
   values by name, not index-assumption where practical.
2. In `collectSchemaOptimizations`: verify whether the candidate source query
   has an explicit LIMIT. If not, add `.slice(0, 5)` on the candidate rows
   before the Promise.all fan-out (mirroring identifyHotTables' LIMIT
   convention). If it HAS a limit ≤10, leave code unchanged but note the value.
3. Tests: existing collectors tests must stay green (they assert outcomes, not
   ordering). Add one test asserting the slice cap when Step 2 adds it.

## Done criteria

- [ ] No sequential `await probe(` chains remain inside the three collectors
- [ ] Candidate fan-out capped at ≤5 rows (or documented existing limit)
- [ ] insights tests + type-check + full unit green

## STOP conditions

- Probes share mutable state or ordering-dependent severity ranking that breaks under allSettled after two fix attempts → STOP with details.
- The candidate query already caps aggressively (<5) AND tests depend on exact counts → leave as-is, report.

## Maintenance notes

- Watch total concurrent ClickHouse load: groups × parallel probes ≈ 12–15
  concurrent tiny aggregates — fine for CH, but reviewers should confirm no
  connection-pool exhaustion locally.
- If generation latency is still dominated by one slow probe later, add
  per-probe timeouts as follow-up.
