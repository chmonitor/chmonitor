# 49 — Query cost estimator (EXPLAIN → rows / memory / time)

## Kickoff prompt

```text
Execute plans/49-query-cost-estimator.md ALONE. Add a pre-flight query cost estimator that
runs EXPLAIN (never executes the query) and estimates rows scanned, peak memory, and wall time.
It powers runaway-query guardrails and the advisor's impact math (plan 46).
Invariants: self-hosted stays whole (fail-open without Clerk); the estimator RUNS EXPLAIN ONLY —
it must never execute the analyzed query and never mutate; AI recommends, never auto-applies;
Postgres=NO for 2026 H2. Read the plan fully, honor STOP conditions, then run every Verification
command and update your row in plans/README.md.
Verify: cd apps/dashboard && bun run type-check && bun run build; bun test src/lib/ai/advisor --isolate; bun run lint.
```

## Current reality (audited)

The agent has query tools (`apps/dashboard/src/lib/ai/agent/tools/query-tools.ts`) and an
`explain_query` path, but **no cost estimate before execution** exists. There is no EXPLAIN
parser and no cardinality propagation. The advisor (plan 46) needs this to rank recommendations
by "granules/bytes saved," and operators need a guardrail against runaway queries.

## Goal

A read-only `estimate_query_cost(sql, hostId)` agent tool that returns
`{ estRows, estBytesRead, estPeakMemoryBytes, estWallMs, confidence, warnings[] }` from EXPLAIN
output only. No execution of the analyzed query.

## Implement now (depth E — resolve open questions during discovery)

- New `apps/dashboard/src/lib/ai/advisor/cost-estimator.ts`:
  - `parseExplainPlan(explainJson)` — extract `ReadFromMergeTree` (granules/marks/bytes),
    `Filter` (selectivity), `Join` (build side), `Aggregating` (group cardinality).
  - `estimateRowsAndMemory(plan, columnStats)` — propagate cardinalities; memory ≈
    max(build_side_rows × row_size, aggregation_state_size).
  - `estimateWallMs(plan, throughputHint)` — bytes_read / bytes_per_sec + rows / rows_per_sec.
- Extend `query-tools.ts` with `estimate_query_cost` — runs `EXPLAIN indexes = 1, json = 1` and
  `EXPLAIN PLAN` with `readonly` transport; **must reject/guard** any attempt to run the raw SQL.
- Pull per-column sizes/types from `system.columns` (already queried elsewhere; reuse a config).
- Tests: `apps/dashboard/src/lib/ai/advisor/__tests__/cost-estimator.test.ts` with fixture EXPLAIN
  JSON for a scan, a join, and an aggregation.
- **Open questions to resolve:** exact EXPLAIN JSON shape across supported CH versions (use the
  `since`/versioned-query mechanism); throughput hint source (static default vs. per-host from
  `query_log`); how to express confidence.

## STOP conditions & drift check

- STOP if `query-tools.ts` moved or the readonly transport contract changed — re-confirm the
  read-only guard before adding a tool that takes arbitrary SQL.
- STOP if EXPLAIN JSON differs materially on the connected CH version; gate with `since` variants
  rather than guessing.
- Drift: if a cost estimator already exists, extend it instead of duplicating.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/ai/advisor --isolate
bun run lint
```

## Done criteria

- `estimate_query_cost` returns rows/memory/time estimates from EXPLAIN only; never executes the
  analyzed query (asserted by a test that fails if the raw SQL is sent).
- Rows/memory within ~2× and time within ~30% on the fixture set.
- Tool available to the agent and to plan 46's impact math.

Priority: P1 · Effort: L · Depth: E · Wave: AI (Advisor) · Lever: AI-differentiation / Adoption
