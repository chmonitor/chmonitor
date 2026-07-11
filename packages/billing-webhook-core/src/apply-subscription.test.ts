/**
 * Tests for the framework-agnostic applySubscription flow. All collaborators
 * are injected via `deps`, so these are pure unit tests with no module mocking —
 * they lock in the ORCHESTRATION contract (owner resolution, live/paid gating,
 * funnel + audit side effects) that both Workers rely on.
 */

import {
  type ApplySubscriptionDeps,
  applySubscription,
  type PolarSubscriptionData,
} from './apply-subscription'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

function makeDeps(overrides: Partial<ApplySubscriptionDeps> = {}) {
  const deps = {
    planForProductId: mock((productId: string) => {
      if (productId === 'prod_free')
        return { planId: 'free' as const, period: 'monthly' as const }
      if (productId === 'prod_pro')
        return { planId: 'pro' as const, period: 'monthly' as const }
      if (productId === 'prod_pro_yearly')
        return { planId: 'pro' as const, period: 'yearly' as const }
      return null
    }),
    ensureOrgForUser: mock(
      async (_userId: string) => 'org_new' as string | null
    ),
    rekeyCustomerToOrg: mock(async (_c: string, _o: string) => {}),
    upsertSubscription: mock(async (_input: unknown) => {}),
    invalidateNegativeCache: mock((_id: string) => {}),
    onUpgradeCompleted: mock(async (_info: unknown) => {}),
    logBillingAudit: mock(async (_info: unknown) => {}),
    logInfo: mock((_m: string, _meta?: unknown) => {}),
    logError: mock((_m: string, _meta?: unknown) => {}),
    ...overrides,
  }
  return deps as unknown as ApplySubscriptionDeps & typeof deps
}

function subData(
  overrides: Partial<Record<string, unknown>> = {}
): PolarSubscriptionData {
  return {
    id: 'sub_1',
    status: 'active',
    productId: 'prod_pro',
    customerId: 'cus_1',
    customer: { externalId: 'user_alice' },
    ...overrides,
  } as PolarSubscriptionData
}

let deps: ReturnType<typeof makeDeps>

beforeEach(() => {
  deps = makeDeps()
})

describe('owner re-keying', () => {
  test('first paid event for a user re-keys the Polar customer externalId to the new org', async () => {
    await applySubscription(subData(), null, undefined, deps)
    expect(deps.ensureOrgForUser).toHaveBeenCalledTimes(1)
    expect(deps.rekeyCustomerToOrg).toHaveBeenCalledTimes(1)
    expect(deps.rekeyCustomerToOrg.mock.calls[0]).toEqual(['cus_1', 'org_new'])
    expect(deps.upsertSubscription).toHaveBeenCalledTimes(1)
    expect(
      (deps.upsertSubscription.mock.calls[0]?.[0] as { userId: string }).userId
    ).toBe('org_new')
  })

  test('org creation failure keeps the user owner and never attempts re-key', async () => {
    deps = makeDeps({ ensureOrgForUser: mock(async () => null) })
    await applySubscription(subData(), null, undefined, deps)
    expect(deps.rekeyCustomerToOrg).not.toHaveBeenCalled()
    expect(
      (deps.upsertSubscription.mock.calls[0]?.[0] as { userId: string }).userId
    ).toBe('user_alice')
  })

  test('an already org-scoped externalId is never re-keyed', async () => {
    await applySubscription(
      subData({ customer: { externalId: 'org_existing' } }),
      null,
      undefined,
      deps
    )
    expect(deps.ensureOrgForUser).not.toHaveBeenCalled()
    expect(deps.rekeyCustomerToOrg).not.toHaveBeenCalled()
  })
})

describe('D1 write failure is non-fatal', () => {
  test('an upsert that throws does not throw out of applySubscription', async () => {
    deps = makeDeps({
      upsertSubscription: mock(async () => {
        throw new Error('D1 down')
      }),
    })
    await expect(
      applySubscription(
        subData({ customer: { externalId: 'org_x' } }),
        null,
        undefined,
        deps
      )
    ).resolves.toBeUndefined()
    expect(deps.logError).toHaveBeenCalled()
  })
})

describe('annual billing period', () => {
  test('a yearly product id persists billingPeriod: yearly', async () => {
    await applySubscription(
      subData({ productId: 'prod_pro_yearly' }),
      null,
      undefined,
      deps
    )
    expect(deps.upsertSubscription.mock.calls[0]?.[0]).toMatchObject({
      planId: 'pro',
      billingPeriod: 'yearly',
    })
  })
})

describe('unknown product', () => {
  test('an unmapped product id is skipped without writing D1', async () => {
    await applySubscription(
      subData({ productId: 'prod_unknown' }),
      null,
      undefined,
      deps
    )
    expect(deps.upsertSubscription).not.toHaveBeenCalled()
    expect(deps.rekeyCustomerToOrg).not.toHaveBeenCalled()
    expect(deps.logError).toHaveBeenCalled()
  })
})

describe('missing externalId', () => {
  test('a subscription without a customer externalId is skipped', async () => {
    await applySubscription(
      subData({ customer: { externalId: null } }),
      null,
      undefined,
      deps
    )
    expect(deps.planForProductId).not.toHaveBeenCalled()
    expect(deps.upsertSubscription).not.toHaveBeenCalled()
  })
})

describe('Free ($0) plan', () => {
  test('a live free subscription persists under the userId with no org creation or re-key', async () => {
    await applySubscription(
      subData({ productId: 'prod_free', customer: { externalId: 'user_bob' } }),
      null,
      undefined,
      deps
    )
    expect(deps.ensureOrgForUser).not.toHaveBeenCalled()
    expect(deps.rekeyCustomerToOrg).not.toHaveBeenCalled()
    expect(deps.upsertSubscription.mock.calls[0]?.[0]).toMatchObject({
      userId: 'user_bob',
      ownerType: 'user',
      planId: 'free',
      billingPeriod: 'monthly',
    })
  })

  test('a live free subscription clears the negative cache for the user', async () => {
    await applySubscription(
      subData({ productId: 'prod_free', customer: { externalId: 'user_bob' } }),
      null,
      undefined,
      deps
    )
    expect(deps.invalidateNegativeCache).toHaveBeenCalledWith('user_bob')
  })

  test('a free subscription.created never fires onUpgradeCompleted', async () => {
    await applySubscription(
      subData({ productId: 'prod_free', customer: { externalId: 'user_bob' } }),
      null,
      'subscription.created',
      deps
    )
    expect(deps.onUpgradeCompleted).not.toHaveBeenCalled()
  })
})

describe('negative cache invalidation', () => {
  test('a live paid subscription invalidates both the raw and resolved owner keys', async () => {
    await applySubscription(subData(), null, undefined, deps)
    expect(deps.invalidateNegativeCache).toHaveBeenCalledWith('user_alice')
    expect(deps.invalidateNegativeCache).toHaveBeenCalledWith('org_new')
  })
})

describe('audit wiring', () => {
  test('an org-scoped active subscription logs a non-canceled audit event', async () => {
    await applySubscription(
      subData({ customer: { externalId: 'org_x' } }),
      null,
      undefined,
      deps
    )
    expect(deps.logBillingAudit).toHaveBeenCalledTimes(1)
    expect(deps.logBillingAudit.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_x',
      canceled: false,
    })
  })

  test('a canceled subscription logs canceled: true', async () => {
    await applySubscription(
      subData({ customer: { externalId: 'org_x' }, status: 'canceled' }),
      null,
      undefined,
      deps
    )
    expect(deps.logBillingAudit.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_x',
      canceled: true,
    })
  })

  test('a user-scoped owner (no Clerk org) is never audit-logged', async () => {
    deps = makeDeps({ ensureOrgForUser: mock(async () => null) })
    await applySubscription(subData(), null, undefined, deps)
    expect(deps.logBillingAudit).not.toHaveBeenCalled()
  })
})

describe('upgrade_completed funnel stitching', () => {
  test('metadata.posthogDistinctId present → passed through as distinctId', async () => {
    await applySubscription(
      subData({ metadata: { posthogDistinctId: 'ph_abc123' } }),
      null,
      'subscription.created',
      deps
    )
    expect(deps.onUpgradeCompleted).toHaveBeenCalledTimes(1)
    expect(deps.onUpgradeCompleted.mock.calls[0]?.[0]).toMatchObject({
      planId: 'pro',
      distinctId: 'ph_abc123',
    })
  })

  test('metadata absent → distinctId undefined without throwing', async () => {
    await applySubscription(subData(), null, 'subscription.created', deps)
    expect(
      (deps.onUpgradeCompleted.mock.calls[0]?.[0] as { distinctId?: string })
        .distinctId
    ).toBeUndefined()
  })

  test('a non-string metadata.posthogDistinctId is ignored', async () => {
    await applySubscription(
      subData({ metadata: { posthogDistinctId: 12345 } }),
      null,
      'subscription.created',
      deps
    )
    expect(
      (deps.onUpgradeCompleted.mock.calls[0]?.[0] as { distinctId?: string })
        .distinctId
    ).toBeUndefined()
  })

  test('subscription.updated (renewal) never fires onUpgradeCompleted', async () => {
    await applySubscription(
      subData({ metadata: { posthogDistinctId: 'ph_abc123' } }),
      null,
      'subscription.updated',
      deps
    )
    expect(deps.onUpgradeCompleted).not.toHaveBeenCalled()
  })
})
