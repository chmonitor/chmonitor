/**
 * Tests for POST /api/v1/org/invite (plans 20 and 99) — the pre-emptive
 * seat-cap gate that rejects an over-cap invite with a 402 BEFORE any Clerk
 * invitation is created (counting both current members AND pending
 * invitations — plan 99), plus the auth/role gates and the fail-open path
 * (plan/member/invite resolution throws → invite proceeds ungated, matching
 * self-hosted/OSS "stays whole").
 *
 * mock.module style mirrors routes/api/v1/webhooks/clerk.test.ts: each mocked
 * export is a stable wrapper delegating to a per-test `let` binding, and
 * `@clerk/tanstack-react-start/server` is mocked with the full superset of
 * methods used across the suite (this file adds
 * `createOrganizationInvitation` and `getOrganizationInvitationList`) so
 * registration stays order-independent when CI runs `bun test src/ --isolate`.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { BILLING_PLANS } from '@/lib/billing/plans'

// --- @/lib/audit/logEvent (leaf specifier) ----------------------------------
let logEventImpl = mock((_e: unknown) => Promise.resolve())
mock.module('@/lib/audit/logEvent', () => ({
  logEvent: (e: unknown) => logEventImpl(e),
}))

// --- @/lib/billing/billing-owner --------------------------------------------
let resolveBillingOwner = mock(
  async (): Promise<{ type: 'org' | 'user'; id: string }> => ({
    type: 'org',
    id: 'org_1',
  })
)
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: () => resolveBillingOwner(),
}))

// --- @/lib/billing/user-subscription ----------------------------------------
let getPlanForOwner = mock(async (_ownerId: string) => BILLING_PLANS.pro)
mock.module('@/lib/billing/user-subscription', () => ({
  isSubscriptionLive: () => true,
  resolveOwnerSubscription: async () => null,
  getPlanIdForOwner: async () => 'free' as const,
  getPlanForOwner: (ownerId: string) => getPlanForOwner(ownerId),
  getUserPlanId: async () => 'free' as const,
  getUserPlan: async () => BILLING_PLANS.free,
}))

// --- @clerk/tanstack-react-start/server -------------------------------------
let authImpl = mock(async () => ({
  userId: 'user_admin',
  orgId: 'org_1',
  orgRole: 'org:admin' as string | null,
}))
let getOrganizationMembershipList = mock(
  async (_args: { organizationId: string; limit: number }) => ({
    data: [] as unknown[],
  })
)
let getOrganizationInvitationList = mock(
  async (_args: {
    organizationId: string
    status?: string[]
    limit: number
  }) => ({ data: [] as unknown[] })
)
let deleteOrganizationMembership = mock(
  async (_args: { organizationId: string; userId: string }) => ({})
)
let usersGetOrganizationMembershipList = mock(
  async (_args: { userId: string }) => ({ data: [] as unknown[] })
)
let createOrganization = mock(
  async (_args: { name: string; createdBy: string }) => ({ id: 'org_new' })
)
let createOrganizationInvitation = mock(
  async (_args: {
    organizationId: string
    emailAddress: string
    role: string
    inviterUserId?: string
  }) => ({ id: 'inv_1' })
)
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: () => authImpl(),
  clerkClient: () => ({
    users: {
      getOrganizationMembershipList: (args: { userId: string }) =>
        usersGetOrganizationMembershipList(args),
    },
    organizations: {
      getOrganizationMembershipList: (args: {
        organizationId: string
        limit: number
      }) => getOrganizationMembershipList(args),
      getOrganizationInvitationList: (args: {
        organizationId: string
        status?: string[]
        limit: number
      }) => getOrganizationInvitationList(args),
      createOrganization: (args: { name: string; createdBy: string }) =>
        createOrganization(args),
      deleteOrganizationMembership: (args: {
        organizationId: string
        userId: string
      }) => deleteOrganizationMembership(args),
      createOrganizationInvitation: (args: {
        organizationId: string
        emailAddress: string
        role: string
        inviterUserId?: string
      }) => createOrganizationInvitation(args),
    },
  }),
}))

const { __handlePostForTests: handlePost } = await import('./invite')

function membershipsOfSize(count: number) {
  return { data: Array.from({ length: count }) }
}

function invitationsOfSize(count: number) {
  return { data: Array.from({ length: count }) }
}

function makeRequest(body: unknown = { emailAddress: 'new@example.com' }) {
  return new Request('https://dash.example.com/api/v1/org/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  logEventImpl = mock(() => Promise.resolve())
  resolveBillingOwner = mock(async () => ({ type: 'org', id: 'org_1' }))
  getPlanForOwner = mock(async () => BILLING_PLANS.pro) // seats: 3
  authImpl = mock(async () => ({
    userId: 'user_admin',
    orgId: 'org_1',
    orgRole: 'org:admin',
  }))
  getOrganizationMembershipList = mock(async () => ({ data: [] }))
  getOrganizationInvitationList = mock(async () => ({ data: [] }))
  deleteOrganizationMembership = mock(async () => ({}))
  usersGetOrganizationMembershipList = mock(async () => ({ data: [] }))
  createOrganization = mock(async () => ({ id: 'org_new' }))
  createOrganizationInvitation = mock(async () => ({ id: 'inv_1' }))
})

describe('POST /api/v1/org/invite — auth gates', () => {
  test('401 when there is no signed-in billing owner', async () => {
    resolveBillingOwner = mock(async () => {
      throw new Error('unauthenticated')
    })

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(401)
    expect(createOrganizationInvitation).not.toHaveBeenCalled()
  })

  test('403 when the billing owner is a user, not an org', async () => {
    resolveBillingOwner = mock(async () => ({
      type: 'user' as const,
      id: 'user_solo',
    }))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(403)
    expect(createOrganizationInvitation).not.toHaveBeenCalled()
  })

  test('403 when the caller is not an org admin', async () => {
    authImpl = mock(async () => ({
      userId: 'user_member',
      orgId: 'org_1',
      orgRole: 'org:member',
    }))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(403)
    expect(createOrganizationInvitation).not.toHaveBeenCalled()
  })

  test('400 when emailAddress is missing', async () => {
    const res = await handlePost(makeRequest({}))

    expect(res.status).toBe(400)
    expect(createOrganizationInvitation).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/org/invite — pre-emptive seat gate', () => {
  test('at cap (currentMembers === seats): 402 reason seat_limit BEFORE the invite is created', async () => {
    getOrganizationMembershipList = mock(async () => membershipsOfSize(3)) // Pro: seats=3

    const res = await handlePost(makeRequest())
    const body = (await res.json()) as {
      error: { details?: { reason?: string } }
    }

    expect(res.status).toBe(402)
    expect(body.error.details?.reason).toBe('seat_limit')
    expect(createOrganizationInvitation).not.toHaveBeenCalled()
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_1',
      event: 'member.invited',
      action: 'invite',
      result: 'denied',
    })
  })

  test('at seats-1: allowed — the Clerk invitation is created', async () => {
    getOrganizationMembershipList = mock(async () => membershipsOfSize(2)) // Pro: seats=3

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(createOrganizationInvitation).toHaveBeenCalledTimes(1)
    expect(createOrganizationInvitation).toHaveBeenCalledWith({
      organizationId: 'org_1',
      emailAddress: 'new@example.com',
      role: 'org:member',
      inviterUserId: 'user_admin',
    })
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      result: 'success',
    })
  })

  test('enterprise plan (seats: null) bypasses the seat check entirely', async () => {
    getPlanForOwner = mock(async () => BILLING_PLANS.enterprise)

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(getOrganizationMembershipList).not.toHaveBeenCalled()
    expect(getOrganizationInvitationList).not.toHaveBeenCalled()
    expect(createOrganizationInvitation).toHaveBeenCalledTimes(1)
  })

  test('fail-open: plan/member resolution throws (no Clerk) → invite proceeds, no 402', async () => {
    getPlanForOwner = mock(async () => {
      throw new Error('Clerk not configured')
    })

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(createOrganizationInvitation).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/v1/org/invite — pending invitations count toward the seat cap', () => {
  test('members=2, pending=0 (cap=3): allowed — the Clerk invitation is created', async () => {
    getOrganizationMembershipList = mock(async () => membershipsOfSize(2))
    getOrganizationInvitationList = mock(async () => invitationsOfSize(0))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(getOrganizationInvitationList).toHaveBeenCalledWith({
      organizationId: 'org_1',
      status: ['pending'],
      limit: 100,
    })
    expect(createOrganizationInvitation).toHaveBeenCalledTimes(1)
  })

  test('members=2, pending=1 (cap=3): blocked — 402 reason seat_limit BEFORE the invite is created', async () => {
    getOrganizationMembershipList = mock(async () => membershipsOfSize(2))
    getOrganizationInvitationList = mock(async () => invitationsOfSize(1))

    const res = await handlePost(makeRequest())
    const body = (await res.json()) as {
      error: { details?: { reason?: string } }
    }

    expect(res.status).toBe(402)
    expect(body.error.details?.reason).toBe('seat_limit')
    expect(createOrganizationInvitation).not.toHaveBeenCalled()
  })

  test('fail-open: pending-invitation list call throws → check is skipped, invite proceeds', async () => {
    getOrganizationMembershipList = mock(async () => membershipsOfSize(2))
    getOrganizationInvitationList = mock(async () => {
      throw new Error('Clerk API hiccup')
    })

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(createOrganizationInvitation).toHaveBeenCalledTimes(1)
  })
})
