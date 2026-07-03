# 59 — AI-generated dashboards

## Kickoff prompt

```text
Execute plans/59-ai-generated-dashboards.md ALONE. Add an agent tool that turns a natural-language
request ("show me everything about replication health") into a built dashboard assembled from the
chart registry, applied via the dashboard builder (plans 56/57).
Invariants: self-hosted stays whole; the agent proposes/builds dashboards from EXISTING registry
charts only (no arbitrary code/DDL; recommends, never auto-applies destructive actions); honest
paywalls (AI usage metered); Postgres=NO for 2026 H2. Read the plan fully, honor STOP conditions,
then run every Verification command and update your row in plans/README.md.
Verify: cd apps/dashboard && bun run type-check && bun run build; bun test src/lib/ai/agent --isolate; bun run lint.
```

## Current reality (audited)

The agent has visualization/dashboard tool categories in the PRD, but there is **no working
NL→dashboard builder** wired to real persistence. Dashboards are localStorage-only until plan 56;
the grid builder arrives in plan 57. This plan composes those with the chart registry.

## Goal

`build_dashboard(request)` agent tool: maps NL + schema/query-history context to a set of registry
charts, constructs a layout, and applies it via plans 56/57 in one click. Charts come only from the
registry (safe, no code-gen).

## Implement now (depth E — resolve open questions during discovery)

- New agent tool in `apps/dashboard/src/lib/ai/agent/tools/` (e.g. `dashboard-tools.ts`):
  `suggest_dashboard(request)` → list of registry chart names + a layout; `build_dashboard` applies
  it via the plan-56 store / plan-57 layout model.
- Ground the mapping in the chart registry (names + categories) + optional schema/query-history
  context so suggestions are relevant; reject any chart not in the registry.
- Meter as AI usage (ties to plan 14/agent budget).
- Tests (golden-style, ties to plan 51): a request yields a valid layout of registry charts, no
  unknown chart names, applied without reload.
- **Open questions:** ranking/selection heuristic, how much query-history context to pass, preview
  vs. auto-apply UX.

## STOP conditions & drift check

- STOP if plans 56/57 aren't merged — gate `build_dashboard` behind their presence; `suggest_` can
  land first (read-only).
- STOP if a suggested chart name isn't in the registry — filter it out, never invent.
- Drift: confirm the chart registry export + the dashboard layout model.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/ai/agent --isolate
bun run lint
```

## Done criteria

- NL request yields a valid dashboard of registry charts, applied without reload.
- No non-registry chart names ever emitted (tested).
- AI usage metered; golden test added.

Priority: P2 · Effort: L · Depth: E · Wave: D (Dashboards) · Lever: AI-differentiation / Adoption · Depends on: 56, 57
