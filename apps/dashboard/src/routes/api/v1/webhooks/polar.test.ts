/**
 * Tests for the Polar webhook's applySubscription() owner-resolution +
 * persistence logic (BE-3 of epic #2097):
 *  - the Polar customer's externalId is re-keyed to the org on lazy org
 *    creation, so the Polar-truth fallback can find it by orgId later.
 *  - a D1 write that fails once is retried before being treated as failed.
 *  - an unmapped Polar product is skipped without touching D1.
 *
 * All external collaborators (Clerk, Polar client, D1-backed subscription
 * store) are mocked so this stays a pure unit test — mirrors the mock.module
 * style in polar-subscription.test.ts and org-host-count.test.ts. Each
 * mocked export is a stable wrapper function that delegates to the current
 * per-test `let` binding, so reassigning the binding inside a test takes
 * effect (a bare re-exported const would be captured once at module-eval
 * time and never see later reassignments). `@tanstack/react-router`'s
 * `createFileRoute` is left un-mocked (matches the existing
 * routes/api/v1/health/webhook.test.ts convention) — it runs for real at
 * import time but route registration isn't under test here.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Mocked at its LEAF specifier (not the @/lib/audit barrel) — see the same
// note in webhooks/clerk.test.ts for why a barrel mock here would risk
// shadowing listAuditLogs/buildAuditCsv for routes/api/v1/audit/export.test.ts.
let logEventImpl = mock((_e: unknown) => Promise.resolve())
mock.module('@/lib/audit/logEvent', () => ({
  logEvent: (e: unknown) => logEventImpl(e),
}))

// #2478 — captures the distinct id the webhook passes for `upgrade_completed`
// so tests can assert the funnel-stitching fallback (metadata present →
// browser distinct id; absent → shared default, no throw).
let captureServerEventImpl = mock(
  (_env: unknown, _event: string, _props?: unknown, _distinctId?: string) =>
    Promise.resolve()
)
mock.module('@/lib/analytics/analytics.server', () => ({
  captureServerEvent: (
    env: unknown,
    event: string,
    props?: unknown,
    distinctId?: string
  ) => captureServerEventImpl(env, event, props, distinctId),
}))

let getOrganizationMembershipList = mock(async (_args: { userId: string }) => ({
  data: [] as Array<{ organization?: { id?: string | null } }>,
}))
let createOrganization = mock(
  async (_args: { name: string; createdBy: string }) => ({ id: 'org_new' })
)
mock.module('@clerk/tanstack-react-start/server', () => ({
  clerkClient: () => ({
    users: {
      getOrganizationMembershipList: (args: { userId: string }) =>
        getOrganizationMembershipList(args),
    },
    organizations: {
      createOrganization: (args: { name: string; createdBy: string }) =>
        createOrganization(args),
    },
  }),
}))

let updateCustomer = mock(
  async (_args: { id: string; customerUpdate: { externalId: string } }) => ({})
)
// Mocks the FULL real export surface of polar-config.ts (not just what this
// file needs): bun's mock.module() registers per module specifier, and
// polar-subscription.test.ts also mocks this same specifier with a different
// export subset. Both files can run in one `bun test` process, so an
// incomplete mock here risks "export not found" if the OTHER file's factory
// wins the registration race. A superset covering every real export is
// resilient regardless of load order.
mock.module('@/lib/billing/polar-config', () => ({
  PAID_PLAN_IDS: ['pro', 'max'] as const,
  getPolarServer: () => 'sandbox' as const,
  isBillingConfigured: () => true,
  getPolarClient: () => ({
    customers: {
      update: (args: { id: string; customerUpdate: { externalId: string } }) =>
        updateCustomer(args),
    },
  }),
  getWebhookSecret: () => 'whsec_test',
  productIdFor: () => null,
  planForProductId: (productId: string) => {
    if (productId === 'prod_free')
      return { planId: 'free', period: 'monthly' as const }
    if (productId === 'prod_pro')
      return { planId: 'pro', period: 'monthly' as const }
    if (productId === 'prod_pro_yearly')
      return { planId: 'pro', period: 'yearly' as const }
    return null
  },
  isPaidPlanId: (value: string) => value === 'pro' || value === 'max',
  isSubscribablePlanId: (value: string) =>
    value === 'free' || value === 'pro' || value === 'max',
}))

let upsertSubscription = mock(async (_input: unknown) => {})
mock.module('@/lib/billing/subscription-store', () => ({
  upsertSubscription: (input: unknown) => upsertSubscription(input),
}))

let invalidateNegativeCache = mock((_externalId: string) => {})
mock.module('@/lib/billing/polar-subscription', () => ({
  invalidateNegativeCache: (externalId: string) =>
    invalidateNegativeCache(externalId),
}))

const { __applySubscriptionForTests: applySubscription } = await import(
  './polar'
)

function subData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    productId: 'prod_pro',
    customerId: 'cus_1',
    customer: { externalId: 'user_alice' },
    ...overrides,
  } as Parameters<typeof applySubscription>[0]
}

beforeEach(() => {
  getOrganizationMembershipList = mock(async () => ({ data: [] }))
  createOrganization = mock(async () => ({ id: 'org_new' }))
  updateCustomer = mock(async () => ({}))
  upsertSubscription = mock(async () => {})
  invalidateNegativeCache = mock(() => {})
  logEventImpl = mock(() => Promise.resolve())
  captureServerEventImpl = mock(() => Promise.resolve())
})

describe('applySubscription — org re-keying', () => {
  test('first paid event for a user re-keys the Polar customer externalId to the new org', async () => {
    await applySubscription(subData())

    expect(createOrganization).toHaveBeenCalledTimes(1)
    expect(updateCustomer).toHaveBeenCalledTimes(1)
    expect(updateCustomer.mock.calls[0]?.[0]).toEqual({
      id: 'cus_1',
      customerUpdate: { externalId: 'org_new' },
    })
    expect(upsertSubscription).toHaveBeenCalledTimes(1)
    expect(
      (upsertSubscription.mock.calls[0]?.[0] as { userId: string }).userId
    ).toBe('org_new')
  })

  test('org creation failure keeps the user owner and never attempts re-key', async () => {
    getOrganizationMembershipList = mock(async () => {
      throw new Error('clerk down')
    })

    await applySubscription(subData())

    expect(updateCustomer).not.toHaveBeenCalled()
    expect(
      (upsertSubscription.mock.calls[0]?.[0] as { userId: string }).userId
    ).toBe('user_alice')
  })

  test('an already org-scoped externalId is never re-keyed (no first-payment transition)', async () => {
    await applySubscription(
      subData({ customer: { externalId: 'org_existing' } })
    )

    expect(createOrganization).not.toHaveBeenCalled()
    expect(updateCustomer).not.toHaveBeenCalled()
  })
})

describe('applySubscription — D1 write retry', () => {
  test('retries once on a transient D1 failure and succeeds', async () => {
    let calls = 0
    upsertSubscription = mock(async () => {
      calls += 1
      if (calls === 1) throw new Error('D1 blip')
    })

    await applySubscription(subData({ customer: { externalId: 'org_x' } }))

    expect(upsertSubscription).toHaveBeenCalledTimes(2)
  })

  test('a write that fails twice does not throw (Polar remains source of truth)', async () => {
    upsertSubscription = mock(async () => {
      throw new Error('D1 down')
    })

    await expect(
      applySubscription(subData({ customer: { externalId: 'org_x' } }))
    ).resolves.toBeUndefined()
    expect(upsertSubscription).toHaveBeenCalledTimes(2)
  })
})

describe('applySubscription — annual billing period', () => {
  test('a yearly product id persists billingPeriod: yearly to D1', async () => {
    await applySubscription(subData({ productId: 'prod_pro_yearly' }))

    expect(upsertSubscription).toHaveBeenCalledTimes(1)
    expect(upsertSubscription.mock.calls[0]?.[0]).toMatchObject({
      planId: 'pro',
      billingPeriod: 'yearly',
    })
  })
})

describe('applySubscription — unknown product', () => {
  test('an unmapped product id is skipped without writing D1', async () => {
    await applySubscription(subData({ productId: 'prod_unknown' }))

    expect(upsertSubscription).not.toHaveBeenCalled()
    expect(updateCustomer).not.toHaveBeenCalled()
  })
})

// Free is a real $0 Polar subscription. It must persist under the USER id (Free
// is user-scoped — no lazy Clerk org), still clear the negative cache so the
// create-connection gate sees it, and NOT count as an upgrade_completed.
describe('applySubscription — Free ($0) plan', () => {
  test('a live free subscription for a user persists under the userId with no org creation or re-key', async () => {
    await applySubscription(
      subData({ productId: 'prod_free', customer: { externalId: 'user_bob' } })
    )

    expect(createOrganization).not.toHaveBeenCalled()
    expect(updateCustomer).not.toHaveBeenCalled()
    expect(upsertSubscription).toHaveBeenCalledTimes(1)
    expect(upsertSubscription.mock.calls[0]?.[0]).toMatchObject({
      userId: 'user_bob',
      ownerType: 'user',
      planId: 'free',
      billingPeriod: 'monthly',
    })
  })

  test('a live free subscription clears the negative cache for the user', async () => {
    await applySubscription(
      subData({ productId: 'prod_free', customer: { externalId: 'user_bob' } })
    )

    expect(invalidateNegativeCache).toHaveBeenCalledWith('user_bob')
  })

  test('a free subscription.created never fires upgrade_completed (only paid upgrades count)', async () => {
    await applySubscription(
      subData({ productId: 'prod_free', customer: { externalId: 'user_bob' } }),
      null,
      'subscription.created'
    )

    expect(captureServerEventImpl).not.toHaveBeenCalled()
  })
})

describe('applySubscription — negative cache invalidation', () => {
  test('a live paid subscription invalidates both the raw and resolved owner keys', async () => {
    await applySubscription(subData())

    expect(invalidateNegativeCache).toHaveBeenCalledWith('user_alice')
    expect(invalidateNegativeCache).toHaveBeenCalledWith('org_new')
  })
})

describe('applySubscription — audit wiring', () => {
  test('an org-scoped active subscription logs billing.plan_changed', async () => {
    await applySubscription(subData({ customer: { externalId: 'org_x' } }))

    expect(logEventImpl).toHaveBeenCalledTimes(1)
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_x',
      event: 'billing.plan_changed',
      action: 'update',
      result: 'success',
    })
  })

  test('a canceled subscription logs billing.canceled instead', async () => {
    await applySubscription(
      subData({ customer: { externalId: 'org_x' }, status: 'canceled' })
    )

    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_x',
      event: 'billing.canceled',
      action: 'update',
      result: 'success',
    })
  })

  test('a user-scoped owner (no Clerk org) is never audit-logged', async () => {
    getOrganizationMembershipList = mock(async () => {
      throw new Error('clerk down')
    })

    await applySubscription(subData()) // falls back to userId owner

    expect(logEventImpl).not.toHaveBeenCalled()
  })

  test('an unmapped product is skipped without an audit row', async () => {
    await applySubscription(subData({ productId: 'prod_unknown' }))

    expect(logEventImpl).not.toHaveBeenCalled()
  })
})

// #2478 — upgrade_completed must carry the browser's PostHog distinct id
// (read off subscription.metadata.posthogDistinctId, propagated by Polar from
// the checkout) so the funnel stitches through the webhook boundary instead of
// reporting under the shared server id.
describe('applySubscription — upgrade_completed funnel stitching', () => {
  test('metadata.posthogDistinctId present → captureServerEvent uses it as the distinct id', async () => {
    await applySubscription(
      subData({ metadata: { posthogDistinctId: 'ph_abc123' } }),
      null,
      'subscription.created'
    )

    expect(captureServerEventImpl).toHaveBeenCalledTimes(1)
    const [, event, props, distinctId] = captureServerEventImpl.mock
      .calls[0] as [unknown, string, unknown, string | undefined]
    expect(event).toBe('upgrade_completed')
    expect(props).toMatchObject({ plan_id: 'pro' })
    expect(distinctId).toBe('ph_abc123')
  })

  test('metadata absent → falls back to the shared default id without throwing', async () => {
    await expect(
      applySubscription(subData(), null, 'subscription.created')
    ).resolves.toBeUndefined()

    expect(captureServerEventImpl).toHaveBeenCalledTimes(1)
    const distinctId = captureServerEventImpl.mock.calls[0]?.[3]
    expect(distinctId).toBeUndefined()
  })

  test('a non-string metadata.posthogDistinctId is ignored, not passed through', async () => {
    await applySubscription(
      subData({ metadata: { posthogDistinctId: 12345 } }),
      null,
      'subscription.created'
    )

    const distinctId = captureServerEventImpl.mock.calls[0]?.[3]
    expect(distinctId).toBeUndefined()
  })

  test('subscription.updated (renewal) never fires upgrade_completed at all', async () => {
    await applySubscription(
      subData({ metadata: { posthogDistinctId: 'ph_abc123' } }),
      null,
      'subscription.updated'
    )

    expect(captureServerEventImpl).not.toHaveBeenCalled()
  })
})
