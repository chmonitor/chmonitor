# Plan 76: Characterization tests for billing plan resolution and Polar product mapping

> **Executor instructions**: Test-only plan — production code must NOT change
> (except exporting an untestable symbol, see STOP conditions). Follow steps,
> verify each. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/lib/billing`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (additive tests)
- **Depends on**: none (protected by plan 75's gate once it lands)
- **Category**: tests
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2493

## Why this matters

The layer that decides **paid vs free** has zero test coverage:
`isSubscriptionLive` (status allowlist + expiry boundary), `getPlanIdForOwner`,
and the Polar product-id↔plan mapping that bridges checkout to entitlements. An
off-by-one at the expiry boundary silently downgrades a paying customer (or
extends a lapsed one); a stale product mapping grants the wrong plan after
checkout. Adjacent billing modules ARE tested (entitlements, plan-enforcement,
seat-enforcement, subscription-store, polar-subscription) — this closes the gap
tying them together.

## Current state

`apps/dashboard/src/lib/billing/user-subscription.ts:25-37`:

```ts
const LIVE_STATUSES = new Set(['active', 'trialing'])

export function isSubscriptionLive(
  sub: Pick<UserSubscription, 'status' | 'currentPeriodEnd'>,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!LIVE_STATUSES.has(sub.status)) return false
  if (sub.currentPeriodEnd != null && sub.currentPeriodEnd < nowSeconds) {
    return false
  }
  return true
}
```

Also in that file: `getPlanIdForOwner` (~line 93), `getPlanForOwner`,
`getUserPlanId`. Untested siblings: `billing-owner.ts:44 resolveBillingOwner`,
`owner-usage.ts:102 resolveOwnerUsage`.

`apps/dashboard/src/lib/billing/polar-config.ts:66-86`:

```ts
function productEnvKey(planId: PaidPlanId, period: BillingPeriod): string {
  return `CHM_POLAR_PRODUCT_${planId.toUpperCase()}_${period.toUpperCase()}`
}
export function productIdFor(planId, period): string | null { ... readEnv ... }
export function planForProductId(productId): { planId; period } | null { ... }
```

Existing test to model after: `apps/dashboard/src/lib/billing/polar-subscription.test.ts`
(mocking patterns for D1/Polar) and any `*.test.ts` in `lib/billing/`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Run billing tests | `cd apps/dashboard && bun test src/lib/billing` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope** (create): `user-subscription.test.ts`, `polar-config.test.ts`,
optionally `billing-owner.test.ts`, `owner-usage.test.ts` — co-located in
`apps/dashboard/src/lib/billing/`.

**Out of scope**: any production source change; Polar webhook handling
(covered); plans 15–20 backlog features.

## Git workflow

- Branch: `advisor/76-billing-resolution-tests`
- Commit: `test(billing): characterize plan resolution and polar product mapping`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: `user-subscription.test.ts`
Table-test `isSubscriptionLive` with injected `nowSeconds`:
- each LIVE status (`active`, `trialing`) → true when unexpired
- dead statuses (`canceled`, `past_due`, `revoked`, arbitrary string) → false
- boundary: `currentPeriodEnd === nowSeconds` → **true** (strict `<`); `nowSeconds - 1` → false; `null` → true
Then `getPlanIdForOwner`: no subscription → `'free'`; live subscription → its
plan; dead subscription → `'free'`; unknown planId in the record → `'free'`
(via `validPlanId`). Mock the store the way `polar-subscription.test.ts` does.
**Verify**: `bun test src/lib/billing/user-subscription.test.ts` → all pass.

### Step 2: `polar-config.test.ts`
With env stubs for each `CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>`:
- round-trip: `planForProductId(productIdFor(plan, period))` returns `{plan, period}` for every paid plan × {monthly, yearly}
- unknown product id → null; unset env → `productIdFor` null
**Verify**: `bun test src/lib/billing/polar-config.test.ts` → all pass.

### Step 3 (stretch): `resolveBillingOwner` / `resolveOwnerUsage`
Only if mocks stay simple (reuse existing patterns); otherwise note as deferred
in the PR description.

## Test plan

(This IS the test plan.) The boundary case in Step 1 encodes the intended
contract — if someone changes `<` to `<=`, a test must fail.

## Done criteria

- [ ] Both new test files exist and pass
- [ ] `git diff --stat` shows only test files added
- [ ] `bun test src/lib/billing` all pass; `pnpm run build` exit 0
- [ ] `plans/README.md` updated

## STOP conditions

- `readEnv` in polar-config.ts can't be stubbed without a production refactor —
  report with the proposed minimal seam rather than refactoring unilaterally.
- The boundary test reveals an actual bug (e.g. paying customers cut off at the
  exact boundary in a way that contradicts Polar semantics) — report it; do NOT
  change production code in this plan.

## Maintenance notes

- When new Polar statuses appear (e.g. `past_due` grace), `LIVE_STATUSES` and
  these tests must change together.
- Reviewer: assert the tests use injected `nowSeconds`, never real time.
