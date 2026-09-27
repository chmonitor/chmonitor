---
id: billing-checkout-flow
title: Billing checkout → webhook → D1 → plan resolution (money path + recovery)
type: workflow
status: active
updated: 2026-09-27
tags:
  - billing
  - polar
  - d1
  - webhook
  - recovery
  - historical-seat-checkout
related:
  - cloud-saas-mode
  - deployment
  - cloud-hooks-worker
---

# Billing checkout → webhook → D1 → plan resolution

> **Scope of this note, after the #3051 removal.** Two flows used to be described here
> and only one of them still exists:
>
> | Section | Status |
> |---|---|
> | License + sponsor checkout (`apps/cloud-hooks`), the Polar webhook, the D1 store, plan resolution, the guarantees, the recovery runbook | **LIVE** — read these. |
> | Cloud (SaaS) **seat** checkout: the `POST /api/v1/billing/checkout` → `checkout.ts` flow, the `checkout.test.ts` coverage, `plan-card.tsx` / `BillingPeriodToggle`, the `/billing` page, and annual seat billing | **HISTORICAL** — removed in #3051 (`bd652fc0`, "remove polar billing from standalone dashboard"). Kept below as history, clearly marked. There is **no successor**: the product it describes no longer exists, so nothing here should be repointed. |

**Money path is landing + cloud-hooks, not the dashboard.** Public paid
checkout is self-host licenses: landing `polarCheckoutHref` →
`GET https://hooks.chmonitor.dev/checkout/license`. Sponsor tiers ($59/$99/$199)
and the custom amount hit
`GET https://hooks.chmonitor.dev/checkout/sponsor?amount=<USD>` (Polar
pay-what-you-want, amount converted to cents). **Polar is the record for
sponsor details**: the offer form forwards name/website/email/logo with the
checkout, which Polar stores on the customer account (`customer_email`,
`customer_name`, `customer_metadata`) and on the order (`metadata`). The
rendered listing is still the committed seed
`apps/landing/src/data/sponsors.ts` — the landing site is static. Polar product IDs
(`CHM_POLAR_LICENSE_TEAM_*`, `CHM_POLAR_LICENSE_UNLIMITED_*`,
`CHM_POLAR_SPONSOR_PRODUCT`, `CHM_POLAR_SERVER`) live in
`apps/cloud-hooks/.env.production` — **and only there**.
`apps/dashboard/.env.production` says so in a comment: *"Polar license product IDs
live on apps/cloud-hooks (hooks.chmonitor.dev), not this dashboard. Do not set
CHM_POLAR_* here."* `apps/dashboard` is a ClickHouse monitor: no `/billing` UI, no
Polar checkout/portal routes, no Polar product IDs in dashboard env. Polar Cloud
Free/Pro/Max products are archived.

Historical Cloud (SaaS) seat checkout (below) used dashboard
`POST /api/v1/billing/checkout`. That route is **removed**. Self-hosted/OSS
has no Polar and **fails open** (see [cloud-saas-mode](cloud-saas-mode.md)).

## Flow — HISTORICAL seat checkout (removed in #3051)

> Everything above the `Polar (hosted)` box is **gone**: `checkout.ts`, the
> `POST /api/v1/billing/checkout` route and the `/billing` page were all deleted in
> #3051 (`bd652fc0`). The **webhook → D1 → plan-resolution half (everything from
> `Polar (hosted)` down) is still live** and is the part worth reading. Kept for
> archaeology: this is where the monotonic-guard and re-key design came from.
> `applySubscription` now lives in `packages/billing-webhook-core`, not in the route.

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
upsert with its monotonic guard) lives in
**`packages/billing-webhook-core`**. License checkout and Polar product IDs
belong on [`apps/cloud-hooks`](cloud-hooks-worker.md)
(`hooks.chmonitor.dev`). The dashboard adapter
`/api/v1/webhooks/polar` may still exist as a thin leftover until Polar
webhooks are cut over to hooks (plans/103). Do **not** put
`CHM_POLAR_LICENSE_*` on the dashboard Worker. Polar secrets, if the
dashboard adapter is still bound, are Worker secrets only.

## Component reference

| Stage | File | Key contract |
|-------|------|--------------|
| License checkout | `apps/cloud-hooks/src/license-checkout.ts` | `GET /checkout/license?sku=&term=` → Polar 302 |
| Sponsor checkout | `apps/cloud-hooks/src/sponsor-checkout.ts` | `GET /checkout/sponsor?amount=<USD>` → Polar pay-what-you-want |
| Webhook receive | `apps/dashboard/src/routes/api/v1/webhooks/polar.ts` | Route handler; `validateEvent` over the **raw** body → `403` bad signature; `501` no secret; `202` on handled event; `500` → Polar retries |
| Signature validation | `apps/dashboard/src/lib/billing/polar-webhooks.ts` (also `apps/cloud-hooks/src/webhook.ts`) | `validateEvent` lives **here**, not in the route. The route re-exports `__applySubscriptionForTests` for its own tests. |
| Owner resolution | `packages/billing-webhook-core/src/apply-subscription.ts` → `applySubscription` | `externalId` `user_*` → lazy Clerk org (idempotent membership check) + re-key customer→org; `org_*` → direct. **This is the real home** — `polar.ts` only wires it up. |
| Unknown product | same file | Logged as **ERROR** (config/deploy mismatch), skipped — never a silent drop, never garbage in D1 |
| D1 write | `apps/dashboard/src/lib/billing/subscription-store.ts` | `upsertSubscription` with the monotonic `event_timestamp` guard; retried once by the caller |
| Plan resolution | `apps/dashboard/src/lib/billing/user-subscription.ts` | `resolveOwnerSubscription` → D1 fast path, else Polar reconcile + write-through; `getPlanForOwner`/`getPlanIdForOwner` default to Free |
| Polar source-of-truth | `apps/dashboard/src/lib/billing/polar-subscription.ts` | `pullOwnerSubscriptionFromPolar(ownerId)` — the reconciliation fallback (+ negative cache) |
| Seat checkout (client) | **REMOVED in #3051** | `checkout.ts` + `POST /api/v1/billing/checkout` + `components/billing/plan-card.tsx` + `routes/(dashboard)/billing.tsx` — no successor, do not repoint. |

## Guarantees

- **Signature IS the auth.** The webhook is unauthenticated by design; a bad
  signature is `403` (`apps/dashboard/src/routes/api/v1/webhooks/polar.ts:262`).
  Never add a second auth gate.
- **Idempotent delivery.** Polar delivers at-least-once. Duplicate `subscription.*`
  events converge: `ensureOrgForUser` reuses an existing org membership rather
  than creating a duplicate (`packages/billing-webhook-core/src/apply-subscription.ts:135`),
  and the store guard treats an **equal** `event_timestamp` as an accepted idempotent replay.
- **Monotonic writes.** A late/replayed **older** event cannot overwrite newer
  state — the store's `ON CONFLICT ... WHERE` guard rejects a stale
  `event_timestamp` (e.g. a stale `canceled` landing after a fresher `active`
  from an uncancel).
- **Non-fatal D1.** A D1 write that fails after one retry is logged but does
  **not** fail the webhook (`apply-subscription.ts:145-166`) — otherwise Polar retries the
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
   mirroring `rekeyCustomerToOrg` in `packages/billing-webhook-core/src/apply-subscription.ts:139`).
3. Trigger a reconcile read (`getPlanForOwner(ownerId)`) to re-seed D1 from
   Polar. A subsequent read should be a cache hit with no Polar call.

### 4. Self-hosted / OSS shows Free unexpectedly
Expected — the dashboard does not require Polar. Guest AI quota still applies
on Cloud. License checkout is on hooks/landing, not the dashboard.

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
- `checkout.test.ts` — **REMOVED in #3051** with the seat checkout it covered (audit wiring,
  a `period: 'yearly'` checkout, the `501` for an unconfigured product). No successor: the
  route is gone. The *idea* it protected — fail closed with `501` rather than throwing — is
  the pattern `apps/cloud-hooks/src/license-checkout.ts` follows today.
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

## Hosted Cloud is free (no Polar seat checkout)

Polar Cloud Free/Pro/Max products are archived. Adding a host does **not**
require a Polar subscription. Public paid checkout is
`GET https://hooks.chmonitor.dev/checkout/license` (self-host licenses),
linked from landing `/pricing`. The dashboard does not sell plans.

## Annual billing (yearly = 10× monthly) — HISTORICAL, seat plans only

> **Removed in #3051.** This described Cloud *seat* annual billing. There is no
> `checkout.ts`, no `productIdFor(planId, period)` in the dashboard, no
> `GET /billing/subscription` route, no `routes/(dashboard)/billing.tsx` page, and no
> `components/billing/plan-card.tsx` / `BillingPeriodToggle` component. A repo-wide
> search for `BillingPeriodToggle` returns nothing; the only surviving `plan-card` is an
> unrelated **CSS class** in `apps/landing/src/pages/license/register.astro`.
>
> What is still true: the pricing numbers are **live** in `packages/pricing/src/plans.ts`
> (`priceYearlyUsd`, `monthlyEquivalentUsd`, `yearlyMonthsFree`) and still drive the
> landing pricing toggle. What is false: the in-app badge path, and the claim that seat
> products are provisioned in `apps/dashboard/.env.production` — that file explicitly
> forbids `CHM_POLAR_*`, and `apps/dashboard/scripts/polar-setup.ts` is now a
> **license-only** script ("Create Polar self-host license products and archive leftover
> Cloud SKUs") that writes product ids to `apps/cloud-hooks/.env.production`.
> License `term` selection (`?sku=&term=`) is the current equivalent.

As it stood before #3051, this was wired end-to-end using the same config-driven
pattern as monthly: `period: 'monthly' | 'yearly'` flowed through `checkout.ts` →
`productIdFor(planId, period)` (env-driven, `CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>`) →
the Polar checkout → the webhook's `planForProductId` reverse map → `billingPeriod`
persisted in D1 (`subscription-store.ts`) → returned by `GET /billing/subscription` →
rendered as a "Billed monthly/yearly" badge on `/billing`. Pricing
(`priceYearlyUsd`, `monthlyEquivalentUsd`, `yearlyMonthsFree`) lived in
`packages/pricing/src/plans.ts` and drove both the landing pricing toggle
(`apps/landing/src/components/Pricing.astro`) and the in-app
`BillingPeriodToggle` (`components/billing/plan-card.tsx`) — no duplicated numbers.
