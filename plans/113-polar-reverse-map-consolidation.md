# Plan 113: Consolidate the Polar product↔plan reverse map into @chm/pricing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/lib/billing/polar-config.ts apps/cloud-hooks/src/billing-deps.ts packages/pricing/src/`
> On mismatch, re-read live files.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW–MED (money-path mapping; behavior must be provably identical)
- **Depends on**: none (plan 104 makes env-driven overrides sane again but is not a hard blocker)
- **Category**: tech-debt / money-path correctness
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3308

## Why this matters

The seat-plan → Polar-product reverse map is implemented twice with the same
constant (`SUBSCRIBABLE_PLAN_IDS = ['free','pro','max']`), the same nested
loop including the free/monthly-only rule, and the same
`CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>` env-key construction — once in the
dashboard's `polar-config.ts:42,87,99–113` and once in cloud-hooks'
`billing-deps.ts:23,31–45`. This is exactly the fork plan 103 warned about:
adding or changing a plan requires lockstep edits in two workers; a miss means
paid webhook events log "unknown Polar product id" and are silently dropped
(`billing-webhook-core/apply-subscription.ts:110–119`) — lost revenue events.

`@chm/pricing` already owns license-side product env keys
(`licenses.ts:81,115` `licensePolarProductEnvKey`) — the subscribable-plan side
belongs there too.

## Current state

Dashboard `apps/dashboard/src/lib/billing/polar-config.ts` (~99–113):

```ts
export function planForProductId(env, productId): { planId, period } | null {
  for (const planId of SUBSCRIBABLE_PLAN_IDS) {
    for (const period of ['monthly', 'yearly'] as const) {
      if (planId === 'free' && period === 'yearly') continue
      const key = polarProductEnvKey(planId, period)   // CHM_POLAR_PRODUCT_...
      if (env[key] === productId) return { planId, period }
    }
  }
  return null
}
```

Cloud-hooks `apps/cloud-hooks/src/billing-deps.ts:27–45`: same shape, local
`SUBSCRIBABLE_PLAN_IDS` + inline key builder.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Package tests | `bun test packages/pricing --isolate` | pass |
| Cloud-hooks tests | `cd apps/cloud-hooks && bun test src/ --isolate` | pass |
| Dashboard billing tests | `cd apps/dashboard && bun test src/lib/billing --isolate` | pass |
| Typecheck | `pnpm run type-check` | exit 0 |

## Scope

**In scope**:
- `packages/pricing/src/` (new export; keep runtime-agnostic — env passed as a lookup fn/plain record, NO process.env access)
- `packages/pricing/src/*.test.ts` (new tests)
- `apps/dashboard/src/lib/billing/polar-config.ts` (thin adapter)
- `apps/cloud-hooks/src/billing-deps.ts` (thin adapter)

**Out of scope**:
- `billing-webhook-core/apply-subscription.ts`
- License-side functions (already consolidated)
- Any webhook handler logic

## Git workflow

- Branch: `advisor/113-polar-map-pricing`
- Commit: `refactor(pricing): single source for Polar product↔plan reverse map`

## Steps

1. In `@chm/pricing` (e.g. `src/plans.ts` or new `src/polar-products.ts`),
   export:
   - `SUBSCRIBABLE_PLAN_IDS` (move the constant)
   - `subscribablePlanProductEnvKey(planId: PlanId, period: 'monthly'|'yearly'): string`
     producing `CHM_POLAR_PRODUCT_${PLAN}_${PERIOD}` (match BOTH existing key builders byte-for-byte — compare outputs first!)
   - `planForProductIdFromLookup(lookup: (key: string) => string | undefined, productId: string): { planId, period } | null`
     implementing the loop with the free/yearly skip.
2. Reimplement both call sites as thin adapters over these exports. Delete the
   duplicated locals. Keep exported names/signatures at the app sites stable so
   their consumers/tests don't change.
3. Tests in packages/pricing: key-builder output equals the old strings for all
   plan/period combos; loop finds monthly-free, skips yearly-free, maps pro/max
   both periods, returns null unknown.
4. Run all four command rows green.

## Done criteria

- [ ] `rg -n "SUBSCRIBABLE_PLAN_IDS" apps packages` shows exactly one definition (in @chm/pricing)
- [ ] All suites green per table
- [ ] No out-of-scope files

## STOP conditions

- The two existing key builders produce DIFFERENT strings today (meaning one site is already broken) → STOP and report which diverges.
- cloud-hooks cannot import from @chm/pricing due to workspace isolation (check its package.json deps) → add the dependency following how it already imports @chm/pricing types (it imports PlanId today, so this should work); if blocked by bundling config, STOP.

## Maintenance notes

- Adding a future plan = edit ONE list in pricing + set env vars on both workers.
- Reviewers: diff the produced env-key strings old-vs-new explicitly.
