---
id: billing-checkout-flow
title: Billing checkout → webhook → D1 → plan resolution (money path + recovery)
type: workflow
status: active
updated: 2026-07-11
tags:
  - billing
  - polar
  - d1
  - webhook
  - recovery
related:
  - cloud-saas-mode
  - deployment
  - cloud-hooks-worker
---

# Billing checkout → webhook → D1 → plan resolution

The revenue critical path: how a paid upgrade travels from a checkout click to
an enforced plan, and how it **self-heals** when a webhook is missed or arrives
out of order. Cloud (SaaS) only — self-hosted/OSS has no Polar/Clerk and
**fails open to the Free plan** at every stage (see [cloud-saas-mode](cloud-saas-mode.md)).

## Flow

```
 ┌────────┐  POST /api/v1/billing/checkout   ┌───────────────┐
 │ client │ ───────────────────────────────▶ │  checkout.ts  │
 └────────┘  { planId, period }              └──────┬────────┘
     ▲                                              │ getPolarClient().checkouts.create({
     │ redirect to Polar-hosted checkout            │   products:[productId],
     │ { url }  ◀───────────────────────────────────┘   externalCustomerId: ownerId,
     │                                                   metadata:{ userId, planId, period } })
     ▼
 ┌─────────────────┐   customer pays    ┌──────────────────────────────────────┐
 │ Polar (hosted)  │ ─────────────────▶ │ POST /api/v1/webhooks/polar          │
 └─────────────────┘  subscription.*    │  1. validateEvent(rawBody,hdrs,secret)│
                       events            │     → 403 on bad signature            │
                                         │  2. applySubscription():              │
                                         │     • unknown product → ERROR log,skip│
                                         │     • user_* first pay → lazy Clerk org│
                                         │       + re-key Polar customer→orgId    │
                                         │     • upsert (retry once, non-fatal)   │
                                         └───────────────┬──────────────────────┘
                                                         │ upsertSubscription({..,eventTimestamp})
                                                         ▼
                                    ┌────────────────────────────────────────┐
                                    │ subscription-store.ts (D1 cache)        │
                                    │  ON CONFLICT ... WHERE monotonic guard: │
                                    │  incoming eventTimestamp >= stored, or   │
                                    │  either null → apply; else REJECT        │
                                    └───────────────┬────────────────────────┘
                                                    │
   getPlanForOwner(ownerId)  ┌──────────────────────▼───────────────────────┐
   ────────────────────────▶ │ user-subscription.ts resolveOwnerSubscription │
                             │  1. D1 cache hit + isSubscriptionLive → use it │
                             │  2. MISS/lapsed → pullOwnerSubscriptionFromPolar│
                             │     (Polar = source of truth) → write-through  │
                             │  3. no sub anywhere → Free (floor)             │
                             └────────────────────────────────────────────────┘
```

## Topology: the webhook is moving to a dedicated worker

The Polar `subscription.*` logic (`applySubscription` + the D1 subscription-store
upsert with its monotonic guard) now lives in the framework-agnostic
**`packages/billing-webhook-core`** package. The dashboard route
`/api/v1/webhooks/polar` is a thin adapter over it — **unchanged in behaviour and
still the live endpoint**. A new Cloud-only worker,
[`apps/cloud-hooks`](cloud-hooks-worker.md) (`hooks.chmonitor.dev`), is the same
adapter plus Telegram ops notifications + scheduled jobs; it deploys but stays
**dormant** until the Polar endpoint is cut over to it (plans/103 step 3-4).
Both Workers bind the same `chm-cloud` D1, so plan resolution is identical
regardless of which one persisted the row. Until cutover, treat the dashboard
route as authoritative.

## Component reference

| Stage | File | Key contract |
|-------|------|--------------|
| Checkout URL | `apps/dashboard/src/routes/api/v1/billing/checkout.ts` | `POST {planId,period}` → `{url}`; `501` if billing not configured / product unmapped; `400` on bad body/plan/period |
| Webhook receive | `apps/dashboard/src/routes/api/v1/webhooks/polar.ts` | `validateEvent` over the **raw** body (`:304`) → `403` bad signature; `501` no secret; `202` on handled event; `500` → Polar retries |
| Owner resolution | `polar.ts` `applySubscription` (`:186`) | `externalId` `user_*` → lazy Clerk org (idempotent membership check) + re-key customer→org; `org_*` → direct |
| Unknown product | `polar.ts` (`:199`) | Logged as **ERROR** (config/deploy mismatch), skipped — never a silent drop, never garbage in D1 |
| D1 write | `apps/dashboard/src/lib/billing/subscription-store.ts` | `upsertSubscription` with the monotonic `event_timestamp` guard; retried once in `polar.ts` (`:158`) |
| Plan resolution | `apps/dashboard/src/lib/billing/user-subscription.ts` | `resolveOwnerSubscription` → D1 fast path, else Polar reconcile + write-through; `getPlanForOwner`/`getPlanIdForOwner` default to Free |
| Polar source-of-truth | `apps/dashboard/src/lib/billing/polar-subscription.ts` | `pullOwnerSubscriptionFromPolar(ownerId)` — the reconciliation fallback (+ negative cache) |

## Guarantees

- **Signature IS the auth.** The webhook is unauthenticated by design; a bad
  signature is `403` (`polar.ts:306-307`). Never add a second auth gate.
- **Idempotent delivery.** Polar delivers at-least-once. Duplicate `subscription.*`
  events converge: `ensureOrgForUser` reuses an existing org membership rather
  than creating a duplicate (`polar.ts:91-103`), and the store guard treats an
  **equal** `event_timestamp` as an accepted idempotent replay.
- **Monotonic writes.** A late/replayed **older** event cannot overwrite newer
  state — the store's `ON CONFLICT ... WHERE` guard rejects a stale
  `event_timestamp` (e.g. a stale `canceled` landing after a fresher `active`
  from an uncancel).
- **Non-fatal D1.** A D1 write that fails after one retry is logged but does
  **not** fail the webhook (`polar.ts:256-266`) — otherwise Polar retries the
  event forever on a `500` even though Polar already holds the truth and the
  next reconcile read self-heals the cache.
- **Free is the floor.** No Clerk owner, no subscription, or a lapsed one all
  resolve to Free (`user-subscription.ts` `isSubscriptionLive` + defaults).

## Recovery procedures

### 1. A webhook was missed or failed to persist
No action usually required — it **self-heals**. The next `getPlanForOwner(ownerId)`
gets a D1 cache miss, calls `pullOwnerSubscriptionFromPolar(ownerId)` (Polar =
source of truth), resolves the correct plan, and writes it through to D1 so the
following read takes the fast path. The only user-visible cost is one Polar
round-trip on that first read.

Precondition: the Polar customer's `externalId` must match the `ownerId` being
resolved. For org owners this depends on the first-payment **re-key**
(`rekeyCustomerToOrg`). If re-key failed (logged as an error), the Polar lookup
`404`s for the org — re-key manually (see step 3) before reconciliation can work.

### 2. Events arrived out of order
No action — the monotonic guard already protected state. Confirm by comparing
the stored `event_timestamp` against the out-of-order event's; the newer one
wins regardless of delivery order.

### 3. Manual reconciliation (cache drift / failed re-key)
1. Fetch the subscription from Polar for the owner (`pullOwnerSubscriptionFromPolar`
   logic, or the Polar dashboard) to confirm the authoritative state.
2. If the customer's `externalId` is still the buyer's `user_*` id but they now
   have an org, re-key it to the `org_*` id (Polar `customers.update`,
   mirroring `rekeyCustomerToOrg` in `polar.ts:135`).
3. Trigger a reconcile read (`getPlanForOwner(ownerId)`) to re-seed D1 from
   Polar. A subsequent read should be a cache hit with no Polar call.

### 4. Self-hosted / OSS shows Free unexpectedly
Expected when Clerk/Polar are not configured — billing resolution fails open to
Free by design. Verify `isBillingConfigured()` and the `CHM_POLAR_*` /
`CHM_CLERK_*` env are set for a Cloud deploy; the checkout route returns `501`
("Billing is not enabled") when they are not.

## Test coverage

Store- and unit-level coverage exists and should be kept green:
- `subscription-store.test.ts` — the monotonic guard predicate (newer wins,
  stale rejected, equal = idempotent replay, no-timestamp write-through, first
  write always applies) plus `billing_period` persistence (monthly/yearly
  round-trip, switching period on a plan change).
- `polar.test.ts` — `applySubscription` owner re-keying, D1 write retry, unknown
  product skip, negative-cache invalidation, and a yearly product id persisting
  `billingPeriod: 'yearly'`.
- `polar-subscription.test.ts` — the negative cache, plus an active annual
  subscription resolving `billingPeriod: 'yearly'` from Polar's `getStateExternal`.
- `checkout.test.ts` — audit wiring, a `period: 'yearly'` checkout resolving the
  yearly Polar product, and a plan with no yearly product configured yet
  failing cleanly with `501` (not a crash) — the "maintainer hasn't run the
  annual step of `scripts/polar-setup.ts` yet" case.
- `user-subscription.test.ts` — `isSubscriptionLive` with annual-length
  `currentPeriodEnd` windows (~365 days), proving liveness depends only on
  `status` + `currentPeriodEnd`, never on `billingPeriod` — a yearly
  subscription is not special-cased.

Route-level checkout/webhook e2e tests (cache-miss reconciliation, fail-open
without Clerk, full request/response round-trip) are **not yet added** as a
single `checkout-e2e.test.ts`: they require new `mock.module` registrations for
billing specifiers that sibling billing test files already mock in `bun test`'s
single process, so they need careful superset-mock engineering to avoid
cross-file contamination. Tracked in `plans/17-checkout-webhook-e2e-tests.md`.

## Free plan = a real $0 Polar subscription (signup gate)

Since 2026-07-11 the Free tier is a real Polar product (`amountType: 'free'`,
monthly-only, name "chmonitor Free", env `CHM_POLAR_PRODUCT_FREE_MONTHLY`,
provisioned by `scripts/polar-setup.ts`). Checkout accepts `planId: 'free'`
(period forced to `'monthly'`; free/yearly → 501) and an optional `returnPath`
(strict same-origin relative path, no `//`/`?`/`#` — see `safeReturnPath`)
so onboarding returns to `/` instead of `/billing`. The webhook/reverse-map
paths are unchanged — `SUBSCRIBABLE_PLAN_IDS = ['free','pro','max']` in
`polar-config.ts` generalizes `productIdFor`/`planForProductId`; `PAID_PLAN_IDS`
still exists for paid-only logic.

**Why:** the signup gate. `POST /api/v1/user-connections` (create) returns
`402` with `details.reason = 'subscription_required'` when
`isCloudModeServer() && isBillingConfigured()` and `resolveOwnerSubscription`
returns null — a cloud user must hold a live subscription (any plan, Free
included) before their first host. This check deliberately uses the raw
subscription record, NOT `getPlanForOwner` (which collapses "no sub" and
"Free sub" into the same Plan). OSS / billing-unconfigured deploys skip the
gate entirely (fail open), and the client mirrors that: a Free checkout that
501s falls back to plain continue (`first-run-empty-state.tsx`).

## Annual billing (yearly = 10× monthly, ≈2 months free)

Wired end-to-end using the same config-driven pattern as monthly: `period:
'monthly' | 'yearly'` flows through `checkout.ts` → `productIdFor(planId,
period)` (env-driven, `CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>`) → the Polar checkout
→ the webhook's `planForProductId` reverse map → `billingPeriod` persisted in
D1 (`subscription-store.ts`) → returned by `GET /billing/subscription` →
rendered as a "Billed monthly/yearly" badge on `/billing`
(`routes/(dashboard)/billing.tsx`). Pricing (`priceYearlyUsd`,
`monthlyEquivalentUsd`, `yearlyMonthsFree`) lives in `packages/pricing/src/plans.ts`
and drives both the landing pricing toggle (`apps/landing/src/components/Pricing.astro`)
and the in-app `BillingPeriodToggle` (`components/billing/plan-card.tsx`) — no
duplicated numbers.

Real Polar products for both periods are already provisioned for prod/preview
(`apps/dashboard/.env.production` / `.env.preview`, created via `bun
apps/dashboard/scripts/polar-setup.ts`, which derives prices from
`BILLING_PLANS` so it can never drift from the pricing source of truth). A plan
with an unconfigured period fails closed: `checkout.ts` returns a clean `501`
("No Polar product configured for `{planId}/{period}`") instead of throwing,
and the billing page surfaces it as a toast — no UI crash, no silent no-op.
