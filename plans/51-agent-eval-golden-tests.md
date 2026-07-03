# 51 — Agent eval & golden-scenario tests

## Current reality (audited)
Tools have unit tests, but there is NO end-to-end agent behavior test — nothing verifies that "given a slow query, the agent explains it and recommends a skip index / PREWHERE." As the advisor (plans 46–50) lands, regressions in tool selection or recommendation safety would ship silently.

## Goal
A `scenarios.test.ts` harness with 12–15 golden scenarios that mock `system.*`/`query_log`, run the agent loop, and assert on tool calls + recommendation shape/safety. New advisor features must add or update a golden.

## Implement now (depth F)
- New `apps/dashboard/src/lib/ai/agent/__tests__/scenarios.test.ts` + `fixtures/` (mock system tables, query_log snapshots, schema).
- A `runAgentScenario(prompt, mockCtx)` helper that drives the existing agent loop with a stubbed LLM/tool transport (deterministic tool selection where possible; assert tool-call inputs).
- Scenarios: slow query → `explain_query` + skip-index/PREWHERE recommendation; fragmented table → parts/merge tool + OPTIMIZE guidance; disk-full → capacity forecast; replication lag → replication tool; high error rate → query/error tool. Each asserts (a) correct tool(s) called, (b) a recommendation is returned, (c) NO destructive auto-execution.
- Wire into CI (the existing `bun test` job); document in `TESTING.md`.

## STOP conditions & drift check
- STOP if the agent loop's public entry/transport can't be driven deterministically — first add a seam (injectable tool transport) rather than testing against a live LLM.
- Drift: confirm the agent module layout under `src/lib/ai/agent/` before wiring fixtures.

## Done criteria
- 12–15 golden scenarios pass; each asserts correct tool calls + a safe recommendation.
- A destructive-auto-exec attempt in any scenario fails the suite.
- CI runs the suite; TESTING.md documents how to add a golden.
