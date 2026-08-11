/**
 * Seat-count resolution tests (issue #2912).
 *
 * `resolveSeatsUsed` is internal, so these drive it through the public
 * `resolveOwnerUsage`. Clerk's membership list is PAGINATED: counting the
 * returned page pinned every org at the page size (100). We must read the
 * server-provided `totalCount` instead, while keeping the fail-safe that a
 * Clerk error degrades to 1 seat (under-count, never a wrong over-limit).
 */

import type { BillingOwner } from './billing-owner'

import { describe, expect, mock, test } from 'bun:test'

interface MembershipPage {
  data: unknown[]
  totalCount?: number
}

/** Swapped per test; defaults to a healthy 1-member org. */
let membershipListImpl: (args: {
  organizationId: string
  limit: number
}) => Promise<MembershipPage> = async () => ({ data: [{}], totalCount: 1 })

/** Records every call so we can assert the common path stays a single request. */
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

// The other metered dimensions are irrelevant here — stub them so the test is
// deterministic and never touches D1 / ClickHouse.
mock.module('./user-subscription', () => ({
  getPlanForOwner: async () => ({ id: 'team', name: 'Team' }),
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

/** A page of `n` placeholder memberships (Clerk caps this at `limit`). */
function page(n: number): unknown[] {
  return Array.from({ length: n }, () => ({}))
}

async function seatsFor(owner: BillingOwner): Promise<number> {
  membershipCalls.length = 0
  const usage = await resolveOwnerUsage(owner, 'user_actor')
  return usage.seatsUsed
}

describe('resolveOwnerUsage — seats', () => {
  test('a 250-member org reports 250, not the 100-row page length', async () => {
    // Clerk returns at most `limit` rows but always the true remote total.
    membershipListImpl = async ({ limit }) => ({
      data: page(Math.min(250, limit)),
      totalCount: 250,
    })
    expect(await seatsFor(ORG)).toBe(250)
  })

  test('counts seats with a single Clerk call (no per-page fan-out)', async () => {
    membershipListImpl = async ({ limit }) => ({
      data: page(Math.min(250, limit)),
      totalCount: 250,
    })
    await seatsFor(ORG)
    expect(membershipCalls).toHaveLength(1)
  })

  test('a small org is unaffected', async () => {
    membershipListImpl = async () => ({ data: page(7), totalCount: 7 })
    expect(await seatsFor(ORG)).toBe(7)
  })

  test('a Clerk failure degrades to 1 seat rather than throwing', async () => {
    membershipListImpl = async () => {
      throw new Error('clerk 503')
    }
    expect(await seatsFor(ORG)).toBe(1)
  })

  test('a missing totalCount falls back to the page length, not to 1', async () => {
    // Guards the older-SDK path: degrade to previous behaviour, not to the
    // 1-seat fail-safe.
    membershipListImpl = async () => ({ data: page(42) })
    expect(await seatsFor(ORG)).toBe(42)
  })

  test('a zero/absent membership count still fail-safes to 1 seat', async () => {
    membershipListImpl = async () => ({ data: [], totalCount: 0 })
    expect(await seatsFor(ORG)).toBe(1)
  })

  test('a user-scoped owner is always 1 seat and never calls Clerk', async () => {
    membershipListImpl = async () => ({ data: page(99), totalCount: 99 })
    expect(await seatsFor({ type: 'user', id: 'user_actor' })).toBe(1)
    expect(membershipCalls).toHaveLength(0)
  })
})
