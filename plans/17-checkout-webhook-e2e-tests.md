# 17 — Checkout → webhook → D1 → plan e2e tests + runbook

## Kickoff prompt

```text
Execute plans/17-checkout-webhook-e2e-tests.md ALONE (do not touch other plans).
Goal: lock the revenue critical path with tests + a runbook — checkout URL
creation, Polar webhook signature/idempotency/monotonic-write guard, and D1
cache-miss → Polar reconciliation. This is TEST + DOCS work; do not change
billing behavior except to make it testable (extract a pure helper if needed).
Invariants you must not violate:
  - Self-hosted/OSS stays whole: billing resolution FAILS OPEN without Clerk/Polar.
    Tests must include a fail-open case (no Clerk → no plan resolution error surfaced).
  - Honest paywalls: advertised ⟺ enforced (or `deferred`). Don't assert a benefit is
    enforced that plan-enforcement.ts marks deferred.
  - AI recommends DDL, never auto-applies (untouched).
  - Postgres/multi-DB: NO for 2026 H2 — the store is D1 only; do not add a DB.
Use Bun test (NOT Jest — it hangs per CLAUDE.md). End by running the Verification
block and pasting results.
```

## Current reality (audited)

The checkout → webhook → D1 → plan-resolution path is the revenue critical path and is under-tested.

- Checkout: `apps/dashboard/src/routes/api/v1/billing/checkout.ts` — `POST` body `{ planId?, period? }`, resolves the Polar product for `planId/period`, calls `getPolarClient().checkouts.create(...)`, returns `{ url }` (`checkout.ts:44–107`). Errors: `No Polar product configured for {planId}/{period}` (`:83`). **No `checkout.test.ts` exists.**
- Webhook: `apps/dashboard/src/routes/api/v1/webhooks/polar.ts` — verifies the signature over the RAW body via `validateEvent` (`polar.ts:47`,`:302–307`; invalid → 403); idempotency guard via existing Clerk-membership check (`:90`); a **monotonic write guard** lives in `subscription-store.ts` (`polar.ts:183` comment). A `polar.test.ts` **already exists** (extend it, don't replace).
- Subscription store: `apps/dashboard/src/lib/billing/subscription-store.ts` (+ `subscription-store.test.ts`) — the monotonic guard and D1 cache live here.
- Plan resolution: `getPlanForOwner` (`apps/dashboard/src/lib/billing/user-subscription.ts`; also referenced from `retention-owner.ts`, `plan-capability.ts`) reads the D1 cache and, on miss, should reconcile against Polar.
- Polar config/client: `apps/dashboard/src/lib/billing/polar-config.ts`, `polar-subscription.ts` (`polar-subscription.test.ts` exists).

## Goal

Three tiers of coverage plus a committed recovery runbook: (1) checkout URL creation is correct and errors cleanly on an unknown product; (2) the webhook rejects bad signatures, is idempotent under duplicate delivery, and never regresses a newer subscription state with an older out-of-order event; (3) a D1 cache miss reconciles from Polar and resolves the right plan. All fail-open without Clerk.

## Implement now

### A. Checkout tests — `apps/dashboard/src/routes/api/v1/billing/checkout.test.ts` (new)
- `valid product → { url }`: stub `getPolarClient().checkouts.create` to return `{ url: 'https://polar…' }`; POST `{ planId:'pro', period:'monthly' }` → 200, body `{ url }` matches; assert `successUrl`/origin derivation from `request.url` (`checkout.ts:98`).
- `unknown product → clean error`: POST `{ planId:'nope' }` → the `No Polar product configured…` path (`:83`), correct status, sanitized (no stack leak).
- `bad body → 4xx`: missing/invalid JSON body handled (`checkout.ts:44`).
- `fail-open`: no Clerk/owner context → route does not 500 with a raw auth error (matches the OSS invariant); assert the mapped response.

### B. Webhook tests — `apps/dashboard/src/routes/api/v1/webhooks/polar.test.ts` (extend)
- `invalid signature → 403`: tamper the body/signature so `validateEvent` throws `WebhookVerificationError` → 403 (`polar.ts:304–307`).
- `idempotency`: deliver the same `subscription.created`/`updated` event twice → D1 is written **once** (no double-membership, no double subscription row). Assert via the store spy.
- `monotonic guard`: deliver an out-of-order event (older `modifiedAt`/revision after a newer one) → the store **does not** overwrite the newer state (`subscription-store.ts` guard; `polar.ts:183`). Add the matching unit test in `subscription-store.test.ts` for the guard predicate itself.
- `unknown product → logged, not crashed`: an event for an unmapped Polar product is logged as ERROR and returns 2xx without writing garbage (`polar.ts:37` behavior).

### C. Reconciliation e2e — `apps/dashboard/src/lib/billing/__tests__/checkout-e2e.test.ts` (new)
- `cache miss → reconcile`: with an empty D1 subscription cache, `getPlanForOwner(owner)` triggers a Polar lookup (stub `polar-subscription.ts`) and resolves the correct paid plan, then populates the cache; a second call is a cache hit (no second Polar call).
- `cache hit → no Polar call`: pre-seed D1; assert Polar client is not called.
- `fail-open`: no Clerk owner → `getPlanForOwner` resolves to the Free/OSS default without throwing (self-hosted-whole invariant).

### D. Runbook — `docs/knowledge/billing-checkout-flow.md` (new)
- Diagram the flow: client → `POST /billing/checkout` → Polar hosted checkout → `POST /webhooks/polar` (signature-verified) → `subscription-store` (monotonic guard) → D1 cache → `getPlanForOwner`.
- **Recovery procedures**: (a) webhook missed/failed → how the next `getPlanForOwner` cache-miss reconciliation self-heals; (b) out-of-order delivery → monotonic guard behavior; (c) manual reconciliation steps (re-fetch subscription from Polar, re-seed D1); (d) how OSS fails open (no Clerk → Free default). Cross-link `checkout.ts`, `polar.ts`, `subscription-store.ts`, `user-subscription.ts`.

### E. Only-if-needed refactor
- If a path can't be tested without executing Polar, extract a **pure** helper (e.g. `resolveProductFor(planId, period)`, or `applySubscriptionEvent(state, event)` for the monotonic guard) and test that directly. Do not change externally observable behavior.

## STOP conditions & drift check
- **STOP if** `polar.ts` no longer uses `validateEvent` for signature auth, or the monotonic guard moved out of `subscription-store.ts` — update the test targets to the real location before writing assertions.
- **STOP if** `checkout.ts` return shape is no longer `{ url }` or the product-mapping error text changed — align assertions to current code.
- **STOP and ask** before adding any new production dependency for mocking; use Bun's built-in mocking + local stubs. Never add Jest.
- **Drift check:** `getPlanForOwner` still lives in `user-subscription.ts` and reconciles on cache miss. If reconciliation moved or was removed, the e2e test target changed — stop and re-locate.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/routes/api/v1/billing/checkout.test.ts src/routes/api/v1/webhooks/polar.test.ts src/lib/billing/__tests__/checkout-e2e.test.ts --isolate
bun run lint
```

## Done criteria
- `checkout.test.ts` proves valid → `{ url }`, unknown product → clean error, and fail-open.
- `polar.test.ts` proves bad signature → 403, duplicate delivery writes once, and out-of-order events don't regress state; `subscription-store.test.ts` covers the monotonic guard predicate.
- `checkout-e2e.test.ts` proves D1 cache-miss reconciliation, cache-hit skips Polar, and fail-open to Free without Clerk.
- `docs/knowledge/billing-checkout-flow.md` committed with the flow diagram + recovery procedures.
- All targeted tests, type-check, build, and lint green.

Priority: P1 · Effort M · Depth: F · Wave: R (Revenue) · Lever: Revenue (protect the money path)
