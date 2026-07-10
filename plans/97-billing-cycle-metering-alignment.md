# Plan 97: Align usage metering with the subscription billing cycle (design + fix)

> **Executor instructions**: Design-first plan. Step 1 produces a decision the
> rest depends on; if the decision can't be made from the evidence listed, STOP
> and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/lib/billing`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (changes what "this month" means for paid users)
- **Depends on**: plans/76 (billing tests) recommended first
- **Category**: business-logic
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2514

## Why this matters

All monthly usage meters — the AI monthly USD budget (hard-enforced in the
agent route) and the host-overage peak meter — reset on the **calendar UTC
month** (`utcMonthKey` = `toISOString().slice(0,7)`), not on the customer's
billing cycle. A subscriber whose cycle starts mid-month gets their AI budget
zeroed early; a cycle straddling the 1st effectively grants two partial
budgets; and when per-host overage billing is wired to Polar (plans/18), the
metered peak won't line up with the invoiced period. The subscription record
already stores the real anchor (`currentPeriodEnd`) — it's just only used for
expiry.

## Current state

- `apps/dashboard/src/lib/billing/ai-usage-store.ts:22-24`:

```ts
/** Returns the UTC month string 'YYYY-MM' for the given instant. */
export function utcMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}
```

  Used by `getAiSpendThisMonth` (~line 176) and by
  `host-usage-store.ts` (~lines 36, 69).
- `subscription-store.ts` (~line 44) and `user-subscription.ts` (~line 32)
  carry `currentPeriodEnd` (unix seconds) — used only in `isSubscriptionLive`.
- OSS invariant: with no D1 / no subscription, billing fails open to Free —
  the calendar month is the only possible key there and must remain the
  fallback.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Billing tests | `cd apps/dashboard && bun test src/lib/billing` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**: a `periodKeyForOwner(owner, now)` helper in `lib/billing/`
(derives the current cycle window from `currentPeriodEnd` + plan interval,
falling back to `utcMonthKey`), its adoption in `ai-usage-store.ts` and
`host-usage-store.ts`, migration/compat handling for in-flight month keys,
tests.

**Out of scope**: wiring overage to Polar invoices (plans/18); changing budget
amounts; daily limits (already cycle-agnostic by design).

## Git workflow

- Branch: `advisor/97-billing-cycle-metering-alignment`
- Commit: `fix(billing): key monthly usage meters to the subscription period`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Decide the period-key shape (write it in the PR first)
Recommended: `period:<currentPeriodEnd>` for owners with a live subscription
(monthly interval: window = [end - 1 month, end]; yearly: budgets remain
MONTHLY inside the year — decide: recommended is monthly sub-windows anchored
to the day-of-month of `currentPeriodEnd`), `utcMonthKey` fallback otherwise.
Check first how `currentPeriodEnd` advances on Polar renewal (see
`polar-subscription.ts` / the webhook handler): if it moves forward each cycle,
`period:<end>` self-partitions. Confirm from the stored data model, not
assumption — if `currentPeriodEnd` does NOT advance per cycle, STOP and report.
**Verify**: decision paragraph written; evidence lines cited.

### Step 2: Implement `periodKeyForOwner` + adopt
Pure function + adoption in both stores. Keep D1 schema unchanged (the key is
already a string column — confirm by reading the two stores' queries).
In-flight transition: on deploy, live paid users' meters reset once (new key) —
call this out in the PR as a one-time, user-favorable reset.
**Verify**: `bun test src/lib/billing` — new table-tests: mid-month cycle start
buckets spend into the cycle window, not the calendar month; fallback path
unchanged for OSS/free.

### Step 3: Boundary tests
Spend at `currentPeriodEnd - 1s` vs `+1s` → different keys; yearly plan
monthly sub-window boundaries; no subscription → `utcMonthKey`.
**Verify**: all pass; build green.

## Done criteria

- [ ] Paid owners' meters key to their cycle; free/OSS unchanged
- [ ] Boundary tests pass; build green
- [ ] Transition behaviour documented in PR; `plans/README.md` updated

## STOP conditions

- `currentPeriodEnd` doesn't advance on renewal (key never rotates) — report;
  the design needs a stored `currentPeriodStart` instead (bigger change).
- The host-overage meter is already consumed by reporting queries that GROUP BY
  month key for display (`billing.tsx` usage card work in plans/16) — check
  and report the display coupling.

## Maintenance notes

- Plans/18 (per-host overage billing) must use the SAME period key when
  reporting usage to Polar — reference this helper there.
