/**
 * Tests for POST /api/v1/billing/checkout — focused on the audit wiring added
 * for plans/22-audit-log-export.md (the checkout-creation flow itself is not
 * otherwise covered by an existing test file).
 *
 * Every mocked specifier carries its full real export surface (not just what
 * this file uses) per the established convention in webhooks/polar.test.ts /
 * webhooks/clerk.test.ts: bun's mock.module() registers per specifier, and
 * `@/lib/billing/polar-config` is also mocked by polar.test.ts /
 * polar-subscription.test.ts with different subsets — a superset keeps
 * registration order-independent when CI runs `bun test src/ --isolate`.
 * `@/lib/audit/logEvent` and `@/lib/billing/billing-owner` are mocked at
 * their LEAF specifiers, never the `@/lib/audit` barrel.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

let logEventImpl = mock((_e: unknown) => Promise.resolve())
mock.module('@/lib/audit/logEvent', () => ({
  logEvent: (e: unknown) => logEventImpl(e),
}))

let resolveConnectionUserId = mock(async () => 'user_1')
mock.module('@/lib/connection-store/auth', () => ({
  GUEST_USER_ID: 'guest',
  resolveConnectionUserId: () => resolveConnectionUserId(),
}))

let resolveBillingOwnerId = mock(async () => 'org_1')
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwnerId: () => resolveBillingOwnerId(),
}))

let checkoutsCreate = mock(async (_args: unknown) => ({
  url: 'https://polar.sh/checkout/abc',
}))
mock.module('@/lib/billing/polar-config', () => ({
  PAID_PLAN_IDS: ['pro', 'max'] as const,
  getPolarServer: () => 'sandbox' as const,
  isBillingConfigured: () => true,
  getPolarClient: () => ({
    checkouts: { create: (args: unknown) => checkoutsCreate(args) },
    customers: { update: async (_args: unknown) => ({}) },
  }),
  getWebhookSecret: () => 'whsec_test',
  productIdFor: (_planId: string, _period: string) => 'prod_pro',
  planForProductId: (productId: string) =>
    productId === 'prod_pro'
      ? { planId: 'pro', period: 'monthly' as const }
      : null,
  isPaidPlanId: (value: string) => value === 'pro' || value === 'max',
}))

const { __handlePostForTests: handlePost } = await import('./checkout')

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('https://dash.example.com/api/v1/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  logEventImpl = mock(() => Promise.resolve())
  resolveConnectionUserId = mock(async () => 'user_1')
  resolveBillingOwnerId = mock(async () => 'org_1')
  checkoutsCreate = mock(async () => ({ url: 'https://polar.sh/checkout/abc' }))
})

describe('POST /api/v1/billing/checkout — audit wiring', () => {
  test('an org-scoped checkout logs billing.checkout with the org id', async () => {
    const res = await handlePost(
      makeRequest({ planId: 'pro', period: 'monthly' })
    )

    expect(res.status).toBe(200)
    expect(logEventImpl).toHaveBeenCalledTimes(1)
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_1',
      userId: 'user_1',
      event: 'billing.checkout',
      resource: 'pro:monthly',
      action: 'create',
      result: 'success',
    })
  })

  test('a first-time upgrade with no org yet (user_* owner) is never audit-logged', async () => {
    resolveBillingOwnerId = mock(async () => 'user_1')

    const res = await handlePost(
      makeRequest({ planId: 'pro', period: 'monthly' })
    )

    expect(res.status).toBe(200)
    expect(logEventImpl).not.toHaveBeenCalled()
  })

  test('a validation failure (bad planId) never reaches checkout creation or logging', async () => {
    const res = await handlePost(
      makeRequest({ planId: 'nope', period: 'monthly' })
    )

    expect(res.status).toBe(400)
    expect(checkoutsCreate).not.toHaveBeenCalled()
    expect(logEventImpl).not.toHaveBeenCalled()
  })
})
