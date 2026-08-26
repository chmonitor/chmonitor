/**
 * Seat-count resolution tests (issue #2912, #3325).
 *
 * `resolveSeatsUsed` is internal, so these drive it through the public
 * `resolveOwnerUsage`. All current plans have `seats: null` (unlimited), so
 * Clerk is short-circuited until GA seat caps land.
 */

import type { BillingOwner } from './billing-owner'

import { BILLING_PLANS } from './plans'
import { describe, expect, mock, test } from 'bun:test'

interface MembershipPage {
  data: unknown[]
  totalCount?: number
}

let membershipListImpl: (args: {
  organizationId: string
  limit: number
}) => Promise<MembershipPage> = async () => ({ data: [{}], totalCount: 1 })

let planForOwnerImpl = async () => BILLING_PLANS.pro

const membershipCalls: Array<{ organizationId: string; limit: number }> = []

mock.module('@clerk/tanstack-react-start/server', () => ({
  clerkClient: () => ({
    organizations: {
      getOrganizationMembershipList: (args: {
        organizationId: string
        limit: number
      }) => {
        membershipCalls.push(args)
        return membershipListImpl(args)
      },
    },
  }),
}))

mock.module('./user-subscription', () => ({
  getPlanForOwner: () => planForOwnerImpl(),
}))
mock.module('./ai-usage-store', () => ({
  getAiUsageToday: async () => 0,
  getAiSpendThisMonth: async () => 0,
}))
mock.module('./host-usage-store', () => ({
  getHostOverageThisMonth: async () => 0,
}))
mock.module('./org-host-count', () => ({
  countOwnerHosts: async () => ({ count: 0 }),
}))
mock.module('@/lib/connection-store/resolve-store', () => ({
  resolveConnectionStore: async () => ({ list: async () => [] }),
}))

const { resolveOwnerUsage } = await import('./owner-usage')

const ORG: BillingOwner = { type: 'org', id: 'org_big' }

function page(n: number): unknown[] {
  return Array.from({ length: n }, () => ({}))
}

async function seatsFor(owner: BillingOwner): Promise<number> {
  membershipCalls.length = 0
  const usage = await resolveOwnerUsage(owner, 'user_actor')
  return usage.seatsUsed
}

describe('resolveOwnerUsage — seats', () => {
  test('current unlimited plans skip Clerk entirely', async () => {
    planForOwnerImpl = async () => BILLING_PLANS.pro
    membershipListImpl = async () => {
      throw new Error('Clerk should not be called')
    }
    expect(await seatsFor(ORG)).toBe(1)
    expect(membershipCalls).toHaveLength(0)
  })

  test('a hypothetical capped plan still calls Clerk once', async () => {
    planForOwnerImpl = async () => ({ ...BILLING_PLANS.pro, seats: 10 })
    membershipListImpl = async ({ limit }) => ({
      data: page(Math.min(250, limit)),
      totalCount: 250,
    })
    expect(await seatsFor(ORG)).toBe(250)
    expect(membershipCalls).toHaveLength(1)
  })

  test('a user-scoped owner is always 1 seat and never calls Clerk', async () => {
    planForOwnerImpl = async () => BILLING_PLANS.pro
    membershipListImpl = async () => ({ data: page(99), totalCount: 99 })
    expect(await seatsFor({ type: 'user', id: 'user_actor' })).toBe(1)
    expect(membershipCalls).toHaveLength(0)
  })
})
