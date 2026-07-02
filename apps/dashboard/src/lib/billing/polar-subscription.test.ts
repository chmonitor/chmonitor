import { afterEach, describe, expect, mock, test } from 'bun:test'

// Mock polar-config so we can drive getStateExternal and count calls. Billing is
// "configured" so the function doesn't early-return.
let getStateExternal = mock(async (_args: { externalId: string }) => ({
  activeSubscriptions: [] as Array<{
    productId: string
    status: string
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
  }>,
}))

// Mocks the FULL real export surface of polar-config.ts (not just what this
// file needs): bun's mock.module() registers per resolved module specifier,
// and routes/api/v1/webhooks/polar.test.ts also mocks this same module (via
// the `@/` alias, which resolves to the same file) with a different export
// subset. Both files can run in one `bun test` process, so an incomplete mock
// here risks "export not found" if the OTHER file's factory wins the
// registration race. A superset covering every real export — including
// `customers.update`, needed by the webhook test — is resilient regardless of
// load order.
mock.module('./polar-config', () => ({
  PAID_PLAN_IDS: ['pro', 'max'] as const,
  getPolarServer: () => 'sandbox' as const,
  isBillingConfigured: () => true,
  getPolarClient: () => ({
    customers: { getStateExternal, update: async () => ({}) },
  }),
  getWebhookSecret: () => 'whsec_test',
  productIdFor: () => null,
  planForProductId: (productId: string) =>
    productId === 'prod_pro'
      ? { planId: 'pro', period: 'monthly' as const }
      : null,
  isPaidPlanId: (value: string) => value === 'pro' || value === 'max',
}))

const {
  pullOwnerSubscriptionFromPolar,
  invalidateNegativeCache,
  __resetPolarSubscriptionCacheForTests,
} = await import('./polar-subscription')

afterEach(() => {
  __resetPolarSubscriptionCacheForTests()
  getStateExternal.mockClear()
})

describe('pullOwnerSubscriptionFromPolar negative cache', () => {
  test('a 404 (no customer) is cached — second read skips Polar', async () => {
    getStateExternal = mock(async () => {
      throw Object.assign(new Error('not found'), { statusCode: 404 })
    })

    const first = await pullOwnerSubscriptionFromPolar('user_free')
    const second = await pullOwnerSubscriptionFromPolar('user_free')

    expect(first).toBeNull()
    expect(second).toBeNull()
    // Only the first read hit Polar; the second was served from the negative cache.
    expect(getStateExternal).toHaveBeenCalledTimes(1)
  })

  test('a transient error is NOT cached — it retries Polar next read', async () => {
    getStateExternal = mock(async () => {
      throw Object.assign(new Error('upstream'), { statusCode: 503 })
    })

    await pullOwnerSubscriptionFromPolar('user_blip')
    await pullOwnerSubscriptionFromPolar('user_blip')

    // Both reads must reach Polar — caching a blip would strand a real sub.
    expect(getStateExternal).toHaveBeenCalledTimes(2)
  })

  test('a paid user is never negatively cached — every read reaches Polar', async () => {
    getStateExternal = mock(async () => ({
      activeSubscriptions: [
        {
          productId: 'prod_pro',
          status: 'active',
          currentPeriodEnd: '2026-12-31T00:00:00Z',
          cancelAtPeriodEnd: false,
        },
      ],
    }))

    const first = await pullOwnerSubscriptionFromPolar('user_pro')
    const second = await pullOwnerSubscriptionFromPolar('user_pro')

    expect(first?.planId).toBe('pro')
    expect(second?.planId).toBe('pro')
    // A positive result must never short-circuit a later read (no false "free").
    expect(getStateExternal).toHaveBeenCalledTimes(2)
  })

  test('invalidateNegativeCache clears a cached negative — the next read reaches Polar', async () => {
    getStateExternal = mock(async () => {
      throw Object.assign(new Error('not found'), { statusCode: 404 })
    })

    // Cache the negative result (simulates a free-user entitlement check).
    const first = await pullOwnerSubscriptionFromPolar('user_justpaid')
    expect(first).toBeNull()
    expect(getStateExternal).toHaveBeenCalledTimes(1)

    // Still within the TTL, an uninvalidated read would be served from cache.
    const stillCached = await pullOwnerSubscriptionFromPolar('user_justpaid')
    expect(stillCached).toBeNull()
    expect(getStateExternal).toHaveBeenCalledTimes(1)

    // Webhook fires (subscription became active) and invalidates the entry.
    invalidateNegativeCache('user_justpaid')

    // Polar now reports an active subscription — the next read must reach it.
    getStateExternal = mock(async () => ({
      activeSubscriptions: [
        {
          productId: 'prod_pro',
          status: 'active',
          currentPeriodEnd: '2026-12-31T00:00:00Z',
          cancelAtPeriodEnd: false,
        },
      ],
    }))

    const afterInvalidate =
      await pullOwnerSubscriptionFromPolar('user_justpaid')
    expect(afterInvalidate?.planId).toBe('pro')
    expect(getStateExternal).toHaveBeenCalledTimes(1)
  })
})
