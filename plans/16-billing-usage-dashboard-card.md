# 16 — Billing usage dashboard card

## Kickoff prompt

```text
Execute plans/16-billing-usage-dashboard-card.md ALONE (do not touch other plans).
Goal: build the in-app billing surface — a card that renders the current plan,
usage meters (hosts, seats, AI-daily, AI-monthly-USD), the renewal date, a
cancel-grace banner, and CTAs to Polar checkout / Polar portal — all from
GET /api/v1/billing/usage.
Invariants you must not violate:
  - Self-hosted/OSS stays whole: /billing/usage fails open without Clerk; the card
    must render a graceful "billing not configured" empty state on OSS, never crash.
  - Honest paywalls: advertised ⟺ enforced (or `deferred`) in lib/billing/plan-enforcement.ts;
    a meter for a `deferred` limit is shown as informational, not "upgrade to unlock".
  - AI recommends DDL, never auto-applies (untouched).
  - Postgres/multi-DB: NO for 2026 H2.
The AI-monthly-USD meter depends on plan 14 surfacing aiSpentThisMonth in /billing/usage;
if that field is absent, degrade that one meter gracefully (do not block the card).
End by running the Verification block and pasting results.
```

## Current reality (audited)

There is no in-app surface for plan/usage/renewal — billing is invisible and so is the upgrade path.

- The route shell already exists: `apps/dashboard/src/routes/(dashboard)/billing.tsx` (present in the route tree). This plan **fills** it, not creates it.
- The data source exists: `apps/dashboard/src/routes/api/v1/billing/usage.ts` returns:
  ```
  { planId, planName,
    hosts:    { used, limit, unlimited },
    seats:    { used, limit, unlimited },
    aiMessages:{ used, limit, unlimited },
    renewal:  { currentPeriodEnd, cancelAtPeriodEnd, status, billingPeriod } }
  ```
  (see `usage.ts:119–129`). After plan 14 it also returns `aiSpentThisMonth` and `aiMonthlyUsdBudget`.
- Checkout/portal actions exist: `POST /api/v1/billing/checkout` → `{ url }`; `POST /api/v1/billing/portal` → `{ url }` (customer portal, `portal.ts:41`).
- Existing billing components to reuse/compose: `apps/dashboard/src/components/billing/{plan-card.tsx, plan-comparison.tsx, usage-summary.tsx}`. The spec's three new files below are additive; check whether `usage-summary.tsx` already covers meters and extend it rather than duplicating.
- A billing hook exists: `apps/dashboard/src/lib/billing/use-billing.ts` (reuse for fetching).

## Goal

`/billing` renders one coherent card: current plan name + price, four usage meters (hosts, seats, AI messages/day, AI USD/month) that turn red past 80%, the renewal date, a cancel-at-period-end grace banner, and two CTAs — "Upgrade" (→ checkout) and "Manage billing" (→ Polar portal). It works for Free, Pro, and over-limit states, and degrades gracefully on OSS.

## Implement now

### A. Data hook
- Reuse `apps/dashboard/src/lib/billing/use-billing.ts` (or add `useBillingUsage()`) to `GET /api/v1/billing/usage` via TanStack Query (the app's data layer). Return typed `{ planId, planName, hosts, seats, aiMessages, aiSpentThisMonth?, aiMonthlyUsdBudget?, renewal }`.
- On error/empty (OSS: no Clerk → route fails open with a null/empty body), expose `isBillingUnavailable = true` so the card renders the empty state.

### B. Meters — `apps/dashboard/src/components/billing/usage-meters.tsx` (new; or extend `usage-summary.tsx`)
```tsx
export function UsageMeters(props: {
  hosts: { used: number; limit: number|null; unlimited: boolean }
  seats: { used: number; limit: number|null; unlimited: boolean }
  aiMessages: { used: number; limit: number|null; unlimited: boolean }
  aiSpentThisMonth?: number
  aiMonthlyUsdBudget?: number|null
}): JSX.Element
```
- One meter row per metric: label, `used / limit` (or "Unlimited" when `unlimited`), a progress bar.
- **Red state** when `limit != null && used/limit >= 0.8`; amber ≥ 0.6 (optional); normal otherwise.
- AI-USD meter: `aiSpentThisMonth / aiMonthlyUsdBudget` formatted as USD. If `aiSpentThisMonth` is undefined (plan 14 not yet merged), render "—" and hide the bar — never throw.
- For any metric whose enforcement is `deferred` (read `plan-enforcement.ts`), append a small "(not billed in early access)" note so the meter is honest.

### C. Current-plan card — `apps/dashboard/src/components/billing/current-plan-card.tsx` (new)
```tsx
export function CurrentPlanCard(props: {
  planId: string; planName: string
  priceMonthlyUsd: number|null      // from @chm/pricing plans
  onUpgrade: () => void             // POST /billing/checkout → assign url
  onManage: () => void              // POST /billing/portal   → assign url
}): JSX.Element
```
- Show plan name + price (from `@chm/pricing`). "Upgrade"/"Change plan" CTA → checkout; "Manage billing" CTA → portal. Hide "Upgrade" on the top tier; hide both on OSS.

### D. Renewal / cancel-grace banner — `apps/dashboard/src/components/billing/renewal-banner.tsx` (new)
```tsx
export function RenewalBanner(props: {
  currentPeriodEnd: string|null
  cancelAtPeriodEnd: boolean
  status: string
}): JSX.Element | null
```
- If `cancelAtPeriodEnd` → warning banner: "Your plan ends on <date>. Reactivate in the billing portal." with a "Manage billing" link.
- Else if `currentPeriodEnd` → subtle "Renews on <date>".
- Returns `null` when there's nothing to show (e.g. Free/OSS).

### E. Assemble the route — `apps/dashboard/src/routes/(dashboard)/billing.tsx`
- Compose `<RenewalBanner/>`, `<CurrentPlanCard/>`, `<UsageMeters/>`, and (optionally) the existing `<PlanComparison/>` below for upsell.
- Empty state when `isBillingUnavailable`: a plain "Billing is managed by your self-hosted deployment / not configured" panel — no CTAs, no crash. (Fail-open invariant.)
- `onUpgrade`: `POST /api/v1/billing/checkout` `{ planId: nextTierId }` → `window.location.assign(url)`.
- `onManage`: `POST /api/v1/billing/portal` → `window.location.assign(url)`.

### F. Tests — `apps/dashboard/src/components/billing/*.test.tsx`
- **Free**: meters show Free caps; "Upgrade" visible; no cancel banner.
- **Pro**: shows Pro caps + renewal date; "Manage billing" visible.
- **Over-limit**: a metric at/above 80% renders the red state.
- **Cancel-grace**: `cancelAtPeriodEnd: true` → banner shows end date + reactivate link.
- **OSS/unavailable**: empty state renders, no CTA, no throw.
- Logic-only assertions (meter color thresholds, next-tier selection) in Bun; component render in Cypress.

## STOP conditions & drift check
- **STOP if** `/api/v1/billing/usage` response keys differ from the audited shape (`hosts/seats/aiMessages/renewal`) — align the hook types to the real response; don't hardcode a stale shape.
- **STOP if** `usage-summary.tsx` already renders full meters — extend it and drop the duplicate `usage-meters.tsx` to avoid two meter components.
- **STOP and ask** if `aiSpentThisMonth` is still absent AND plan 14 is not scheduled — ship the card with the AI-USD meter degraded (documented), don't block.
- **Drift check:** `checkout.ts`/`portal.ts` still return `{ url }`. If the portal moved to GET or the field renamed, fix the CTAs.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/components/billing/ --isolate
bun run lint
```

## Done criteria
- `/billing` shows plan, four meters (hosts/seats/AI-daily/AI-USD), renewal date, and cancel-grace banner.
- Meters turn red past 80%; unlimited caps render "Unlimited"; deferred limits are labeled informational.
- "Upgrade" opens checkout URL; "Manage billing" opens Polar portal URL.
- OSS/unavailable state renders a graceful empty panel with no CTAs and no crash.
- Free / Pro / over-limit / cancel-grace tests pass; type-check, build, lint green.

Priority: P0 · Effort M · Depth: F · Wave: R (Revenue) · Lever: Revenue/Adoption (visible plan + upgrade path)
