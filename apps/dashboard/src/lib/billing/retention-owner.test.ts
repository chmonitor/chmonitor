/**
 * Tests for retention-owner.ts — the session-less billing-owner → retention-plan
 * resolution used by the retention-prune cron.
 *
 * We unit-test the pure `mostGenerousRetentionPlan` selector (the core of the
 * fix: pick the OWNER plan with the longest retention so prune never deletes
 * data the UI still shows). The async `resolveRetentionPlanForUser` depends on
 * the Clerk API and D1 and is exercised via the cron's integration path.
 */

import { describe, expect, mock, test } from 'bun:test'
import { BILLING_PLANS } from '@chm/pricing'

// retention-owner statically imports getPlanForOwner → subscription-store →
// @chm/platform → platform-native, which imports the virtual `cloudflare:workers`
// module. That module only resolves under vite/workerd, so stub it (it just
// re-exports `env`). These tests only exercise the pure selector, which never
// touches a binding. Mirrors src/lib/insights/store/resolve-store.test.ts.
mock.module('cloudflare:workers', () => ({ env: {} }))

const getPlanForOwner = mock(async (_ownerId: string) => BILLING_PLANS.free)
mock.module('./user-subscription', () => ({
  getPlanForOwner: (id: string) => getPlanForOwner(id),
}))
mock.module('@clerk/tanstack-react-start/server', () => ({
  clerkClient: () => ({
    users: {
      getOrganizationMembershipList: async () => ({
        data: [{ organization: { id: 'org_shared' } }],
      }),
    },
  }),
}))

const { mostGenerousRetentionPlan, resolveRetentionPlanForUser } = await import(
  './retention-owner'
)

const { free, pro, max, enterprise } = BILLING_PLANS

describe('mostGenerousRetentionPlan', () => {
  test('returns the single plan for a one-element list', () => {
    expect(mostGenerousRetentionPlan([free]).id).toBe('free')
  })

  test('prefers the plan with the longer retention window (pro > free)', () => {
    expect(mostGenerousRetentionPlan([free, pro]).id).toBe('pro')
    expect(mostGenerousRetentionPlan([pro, free]).id).toBe('pro')
  })

  test('prefers max (90d) over pro (30d) and free (7d)', () => {
    expect(mostGenerousRetentionPlan([free, pro, max]).id).toBe('max')
  })

  test('unlimited retention (enterprise, retentionDays null) always wins', () => {
    expect(mostGenerousRetentionPlan([free, enterprise]).id).toBe('enterprise')
    expect(mostGenerousRetentionPlan([enterprise, max]).id).toBe('enterprise')
    expect(mostGenerousRetentionPlan([max, enterprise, free]).id).toBe(
      'enterprise'
    )
  })

  test('throws on an empty list', () => {
    expect(() => mostGenerousRetentionPlan([])).toThrow()
  })
})

describe('resolveRetentionPlanForUser plan cache', () => {
  test('a shared org is looked up once per run across users', async () => {
    getPlanForOwner.mockClear()
    const cache = new Map()

    await resolveRetentionPlanForUser('user_a', cache)
    await resolveRetentionPlanForUser('user_b', cache)

    const owners = getPlanForOwner.mock.calls.map((c) => c[0]).sort()
    expect(owners).toEqual(['org_shared', 'user_a', 'user_b'])
  })

  test('a failed owner lookup rejects (fail closed)', async () => {
    getPlanForOwner.mockImplementationOnce(async () => {
      throw new Error('d1 down')
    })

    await expect(
      resolveRetentionPlanForUser('user_c', new Map())
    ).rejects.toThrow('d1 down')
  })
})
