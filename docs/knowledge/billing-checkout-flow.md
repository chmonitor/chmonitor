---
id: billing-checkout-flow
title: Billing checkout → webhook → D1 → plan resolution (money path + recovery)
type: workflow
status: active
updated: 2026-07-03
tags:
  - billing
  - polar
  - d1
  - webhook
  - recovery
related:
  - cloud-saas-mode
  - deployment
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
  write always applies).
- `polar.test.ts` — `applySubscription` owner re-keying, D1 write retry, unknown
  product skip, negative-cache invalidation.

Route-level checkout/webhook e2e tests (checkout `{url}`/error paths, webhook
`403`/idempotency, cache-miss reconciliation) are **not yet added**: they require
new `mock.module` registrations for billing specifiers that sibling billing test
files already mock in `bun test`'s single process, so they need careful
superset-mock engineering to avoid cross-file contamination. Tracked in
`plans/17-checkout-webhook-e2e-tests.md`.
