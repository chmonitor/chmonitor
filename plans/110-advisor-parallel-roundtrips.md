# Plan 110: Parallelize the advisor engines' serial ClickHouse round-trips

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/lib/ai/advisor/tuning/`
> On mismatch, re-read live files.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3305

## Why this matters

The advisor's tuning engine awaits 4–5 independent ClickHouse queries strictly
sequentially, and the recommendation engine runs three more serial round-trips
after its one parallel pair. `/api/v1/advisor/tuning` latency is therefore the
SUM of ~7 Worker→ClickHouse RTTs instead of the MAX of ~3 parallel rounds —
several times slower on every advisor scan, which also consumes a metered
AI-request credit while the user waits.

## Current state

`apps/dashboard/src/lib/ai/advisor/tuning/tuning-engine.ts` (~line 389–430):

```ts
let columns: ColumnProfile[]
try {
  columns = await fetchColumnProfiles(hostId, database, table)
} catch (err) { ...return ok:false... }
...
const settings = await fetchSettings(hostId)
...
const tables = await fetchTableProfiles(hostId, database, table, columns)
...
const cluster = await fetchClusterContext(hostId, database)

const findings = rankFindings([
  ...runSchemaRules(columns),
  ...runTableRules(tables, cluster),
  ...runSettingsRules(settings),
])
```

Dependency analysis: only `fetchTableProfiles` consumes `columns`; `settings`
and `cluster` are independent. Same pattern in
`lib/ai/advisor/recommendation-engine.ts:201–263`: after the parallel
schema/parts pair, `fetchExplainIndexes`, `measurePrewhereImpact`, and
`fetchTableTopology` each await serially though independent (topology needs
only database/table, known before the pair starts).

Each existing step has its own try/catch degradation — preserve that per-step
behavior.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Advisor tests | `cd apps/dashboard && bun test src/lib/ai/advisor --isolate` | pass |
| Typecheck | `pnpm run type-check` | exit 0 |
| Full unit | `pnpm run test:unit` | pass |

## Scope

**In scope**:
- `apps/dashboard/src/lib/ai/advisor/tuning/tuning-engine.ts`
- `apps/dashboard/src/lib/ai/advisor/recommendation-engine.ts`

**Out of scope**:
- Any change to the fetch functions themselves, SQL, or rule logic
- mv-designer / cost-estimator / capacity-forecaster (separate follow-up if patterns exist there too — note but don't touch)
- Route handlers

## Git workflow

- Branch: `advisor/110-advisor-parallel-roundtrips`
- Commit: `perf(advisor): parallelize independent ClickHouse fetches in engines`

## Steps

### Step 1: Restructure analyzeTuning fetch phase

Reorder into two rounds preserving semantics:

Round 1 (all independent): kick off `columnsP = fetchColumnProfiles(...)`,
`settingsP = fetchSettings(...)`, `clusterP = fetchClusterContext(...)` as
promises WITHOUT awaiting together yet. Then `await columnsP` FIRST so the
existing empty-columns early-return and error handling still short-circuit
before consuming the others; keep its try/catch exactly.
Round 2: `tables = await fetchTableProfiles(..., await columnsP)` then
`await Promise.all([settingsP, clusterP])` (each with its original try/catch —
wrap individually or use allSettled + explicit rethrow to keep messages).

If a fetch failure previously aborted the whole scan with its specific error
message, preserve that behavior for column failures; settings/table failures
that previously produced notes/degradation must still degrade, not throw.

### Step 2: Same treatment in recommendation-engine.analyzeQuery

Move `fetchExplainIndexes` into the first parallel round (or start it as an
unawaited promise at function entry). Start `fetchTableTopology` concurrently
with the schema/pairs round (it needs only database/table). Keep
`measurePrewhereImpact` wherever EXPLAIN results require ordering — read the
data dependency first; if genuinely dependent on explain-index output, leave it
and note that in NOTES.

### Step 3: Tests

Existing advisor tests (`src/lib/ai/advisor/__tests__/`) must pass unchanged —
they assert results, not call ordering. Add one test asserting concurrency IF
the mock harness makes it cheap (e.g., track in-flight counts); otherwise rely
on behavior tests + type-check and say so in NOTES.

## Done criteria

- [ ] No two consecutive `await fetch*(` calls remain where the second doesn't consume the first's value in either engine (inspect final code)
- [ ] All advisor unit tests pass; type-check green; full unit suite green

## STOP conditions

- A hidden data dependency emerges (a "parallel" fetch actually reads another's result) → leave that chain serial, document why in NOTES; if >1 such dependency, STOP.
- Test mocks assume strict call ORDER (not just outcomes) → adapt mocks minimally within test files (in scope by necessity); if pervasive, STOP.

## Maintenance notes

- Reviewers: confirm error-message text for column failures unchanged (tests + UX depend on exact strings).
- If advisor latency is later traced further, the next lever is caching topology/settings per host for N minutes (out of scope).
