# 14 — Wire AI overage spend metering

## Current reality (audited)
Overage revenue is unplugged. `ai_usage_monthly` exists (`apps/dashboard/src/lib/billing/ai-usage-store.ts:158`, `CREATE TABLE ai_usage_monthly (...)`) and `addAiSpend(owner, usd)` is exported (`ai-usage-store.ts:199`). The agent route already imports and calls it:
- `apps/dashboard/src/routes/api/v1/agent.ts:67` imports `addAiSpend`; `:75` imports `checkAiDailyLimit`.
- `agent.ts:695-790` aggregates per-step usage and calls `aggregateUsageWithCost(usageSteps, model)` → `stats.estimatedCostUsd`.
- `agent.ts:797` and `:824` call `await addAiSpend(billingOwnerId, stats.estimatedCostUsd)` on both success and abbreviated-finish paths.
Cost IS computed from real token usage × model price and IS written to D1. Gaps are semantic:
1. No "past the included allowance" boundary — `addAiSpend` accumulates the full per-request cost every time.
2. Free is not hard-capped in the meter path. Free carries `aiOverage: null` (`packages/pricing/src/plans.ts:98`) and `aiMonthlyUsdBudget: 0.5`, `aiRequestsPerDay: 5`. The daily gate (`checkAiDailyLimit`, `agent.ts:601-603`) blocks Free past 5/day, but nothing asserts Free's monthly USD stays a hard cap.
3. Usage API hides the number: `apps/dashboard/src/routes/api/v1/billing/usage.ts:119-129` returns `{ planId, planName, hosts, seats, aiMessages, renewal }` — never `aiSpentThisMonth`/`aiMonthlyUsdBudget`.
4. No test proving Free = hard-cap / Pro = meter-overage.
Plan-type facts (`packages/pricing/src/plans.ts`): `aiMonthlyUsdBudget: number|null`, `aiRequestsPerDay: number|null`, `aiOverage: { usdPer: number; messages: number } | null`. Free `aiOverage: null`; Pro `aiOverage: { usdPer: 5, messages: 2000 }`, `aiMonthlyUsdBudget: 5`.

## Goal
Overage USD accumulates in D1 only for paid tiers and only past the included daily allowance; Free never accrues overage (hard cap enforced by the daily-message gate); usage API returns `aiSpentThisMonth` alongside `aiMonthlyUsdBudget`; a test proves Free = hard-cap while Pro = meter. All fails open (no Clerk → no metering).

## Implement now
### A. `apps/dashboard/src/lib/billing/ai-usage-store.ts`
- Keep `addAiSpend(ownerId, usd)` (upserts `ai_usage_monthly(owner_id, month, spent_usd, updated_at)`).
- Add `getAiSpentThisMonth(ownerId: string): Promise<number>` (SELECT `spent_usd` WHERE owner_id=?1 AND month=?2, current month key; return 0 on miss). A `SELECT spent_usd` for the current month already exists near `:184` — extract/expose as this named export.
- Add `meterAiOverage(plan: Plan, ownerId: string, requestCostUsd: number): Promise<void>`:
  - if `plan.aiOverage == null` → return WITHOUT writing (Free hard-cap; daily gate blocks abuse).
  - else `await addAiSpend(ownerId, requestCostUsd)`. Keep "only past the included allowance" simple: the included allowance is the daily-message budget (already gated); everything a paid user runs is billable overage-eligible spend tracked against `aiMonthlyUsdBudget`. Do NOT invent a per-day USD sub-ledger (deferred; record in STOP).
### B. `apps/dashboard/src/routes/api/v1/agent.ts`
- Resolve `plan` for `billingOwnerId` where it is already resolved for `checkAiDailyLimit` (~`:560-603`).
- Replace both bare `await addAiSpend(billingOwnerId, stats.estimatedCostUsd)` calls (`:797`, `:824`) with `await meterAiOverage(plan, billingOwnerId, stats.estimatedCostUsd)`.
- Preserve fail-open: if `plan` unavailable, do not meter.
### C. `apps/dashboard/src/routes/api/v1/billing/usage.ts`
- Add `resolveAiSpentThisMonth(owner.id)` to the existing `Promise.all` (`:105-117`).
- Extend the response (`:119`) with `aiSpentThisMonth: aiSpent` (number, USD this month) and `aiMonthlyUsdBudget: plan.aiMonthlyUsdBudget` (number|null). Keep every existing key unchanged.
### D. `apps/dashboard/src/lib/billing/plan-enforcement.ts`
- If `aiMonthlyUsdBudget`/`aiOverage` is `deferred`, flip to `{ status: 'enforced', gate: 'agent.ts meterAiOverage → ai-usage-store.addAiSpend; usage.ts surfaces aiSpentThisMonth' }`. If already `enforced`, update the gate string to name `meterAiOverage`.
### E. Test — `apps/dashboard/src/lib/billing/ai-usage-store.test.ts` (extend)
- Free hard-caps: `meterAiOverage(FREE_PLAN, owner, 0.10)` writes nothing (`getAiSpentThisMonth` stays 0).
- Pro meters: `meterAiOverage(PRO_PLAN, owner, 0.10)` accrues 0.10; a second call → 0.20.
- fail-open: when the D1 binding is absent/throws, `meterAiOverage` does not throw.

## STOP conditions & drift check
- STOP if `agent.ts` no longer imports `addAiSpend` or `aggregateUsageWithCost` is gone.
- STOP if `usage.ts` already returns `aiSpentThisMonth` (someone shipped part of this) — reconcile, don't duplicate.
- STOP and defer before building a per-day USD sub-ledger.
- Drift: `plans.ts` still has `aiOverage` as `{ usdPer; messages } | null` and Free `aiOverage: null`. If Free gained an `aiOverage` object, stop.

## Done criteria
- `meterAiOverage` exists; Free writes zero overage; paid tiers accumulate `spent_usd`.
- `agent.ts` routes both finish paths through `meterAiOverage(plan, …)`, still fail-open.
- `GET /api/v1/billing/usage` returns `aiSpentThisMonth` (number) + `aiMonthlyUsdBudget` (number|null); all prior keys intact.
- `plan-enforcement.ts` marks AI-budget/overage `enforced` naming `meterAiOverage`.
- New tests pass; type-check + tsconfig.test typecheck + lint green.
