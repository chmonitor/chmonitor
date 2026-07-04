/**
 * Tests for the Clerk webhook handler (POST /api/v1/webhooks/clerk) — the
 * signature gate, the config gate, and the org seat-cap enforcement for
 * `organizationMembership.created` events (clerk.ts:47-90).
 *
 * checkSeatLimit() (lib/billing/entitlements) is left REAL/un-mocked so the
 * "at cap" / "over cap" cases below exercise the actual `count - 1` off-by-one
 * at clerk.ts:72 — lib/billing/seat-enforcement.test.ts only tests a
 * *reimplementation* of that arithmetic and never imports clerk.ts, so it
 * cannot catch a regression there.
 *
 * mock.module style mirrors routes/api/v1/webhooks/polar.test.ts: each mocked
 * export is a stable wrapper delegating to a per-test `let` binding (so
 * reassigning the binding inside a test takes effect — a bare re-exported
 * const would be captured once at module-eval time and never see later
 * reassignments). Every specifier is mocked with its full real export
 * surface, not just what this file uses: `@clerk/tanstack-react-start/server`
 * is also mocked by org-host-count.test.ts (organizations.
 * getOrganizationMembershipList) and polar.test.ts (users.
 * getOrganizationMembershipList + organizations.createOrganization) with
 * different subsets, and bun's mock.module() registers per specifier, so a
 * superset keeps registration order-independent when CI runs `bun test src/
 * --isolate`. `@tanstack/react-router`'s `createFileRoute` is left un-mocked.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { BILLING_PLANS } from '@/lib/billing/plans'

// --- @/lib/audit/logEvent (leaf specifier, not the @/lib/audit barrel) ------
// Mocking the leaf here (not the barrel) so a partial mock here can never
// shadow the barrel's other exports (listAuditLogs/buildAuditCsv) for
// routes/api/v1/audit/export.test.ts when both share a `bun test src/
// --isolate` process.
let logEventImpl = mock((_e: unknown) => Promise.resolve())
mock.module('@/lib/audit/logEvent', () => ({
  logEvent: (e: unknown) => logEventImpl(e),
}))

// --- @clerk/tanstack-react-start/webhooks -----------------------------------
// Full real export surface: verifyWebhook is its only runtime export.
type ClerkWebhookFixture = { type: string; data: Record<string, unknown> }

function orgMembershipEvent(
  orgId = 'org_1',
  userId = 'user_new'
): ClerkWebhookFixture {
  return {
    type: 'organizationMembership.created',
    data: {
      organization: { id: orgId },
      public_user_data: { user_id: userId },
    },
  }
}

let verifyWebhookImpl = mock(
  async (
    _req: Request,
    _opts?: { signingSecret?: string }
  ): Promise<ClerkWebhookFixture> => orgMembershipEvent()
)
mock.module('@clerk/tanstack-react-start/webhooks', () => ({
  verifyWebhook: (req: Request, opts?: { signingSecret?: string }) =>
    verifyWebhookImpl(req, opts),
}))

// --- @/lib/billing/clerk-webhook-config -------------------------------------
// Full real export surface: getClerkWebhookSecret is its only export.
let getClerkWebhookSecret = mock((): string | undefined => 'whsec_test')
mock.module('@/lib/billing/clerk-webhook-config', () => ({
  getClerkWebhookSecret: () => getClerkWebhookSecret(),
}))

// --- @/lib/billing/user-subscription -----------------------------------------
// Full real export surface (clerk.ts only calls getPlanForOwner); the other
// five are unused stubs kept for cross-file mock.module registration safety.
let getPlanForOwner = mock(async (_ownerId: string) => BILLING_PLANS.pro)
mock.module('@/lib/billing/user-subscription', () => ({
  isSubscriptionLive: () => true,
  resolveOwnerSubscription: async () => null,
  getPlanIdForOwner: async () => 'free' as const,
  getPlanForOwner: (ownerId: string) => getPlanForOwner(ownerId),
  getUserPlanId: async () => 'free' as const,
  getUserPlan: async () => BILLING_PLANS.free,
}))

// --- @clerk/tanstack-react-start/server (lazy import()'d inside clerk.ts) ---
// Superset of the clerkClient() surface mocked across the suite: this file
// adds organizations.deleteOrganizationMembership and keeps
// organizations.getOrganizationMembershipList (org-host-count.test.ts) plus
// users.getOrganizationMembershipList / organizations.createOrganization
// (polar.test.ts) plus auth / organizations.createOrganizationInvitation
// (routes/api/v1/org/invite.test.ts) so registration for this shared
// specifier is order-independent.
let getOrganizationMembershipList = mock(
  async (_args: { organizationId: string; limit: number }) => ({
    data: [] as unknown[],
  })
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
const createOrganizationInvitation = mock(
  async (_args: {
    organizationId: string
    emailAddress: string
    role: string
    inviterUserId?: string
  }) => ({ id: 'inv_1' })
)
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => ({ userId: 'user_admin', orgId: 'org_1' }),
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

const { __handlePostForTests: handlePost } = await import('./clerk')

function membershipsOfSize(count: number) {
  return { data: Array.from({ length: count }) }
}

function makeRequest(): Request {
  return new Request('https://dash.example.com/api/v1/webhooks/clerk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

beforeEach(() => {
  verifyWebhookImpl = mock(async () => orgMembershipEvent())
  getClerkWebhookSecret = mock(() => 'whsec_test')
  getPlanForOwner = mock(async () => BILLING_PLANS.pro)
  getOrganizationMembershipList = mock(async () => ({ data: [] }))
  deleteOrganizationMembership = mock(async () => ({}))
  usersGetOrganizationMembershipList = mock(async () => ({ data: [] }))
  createOrganization = mock(async () => ({ id: 'org_new' }))
  logEventImpl = mock(() => Promise.resolve())
})

describe('POST /api/v1/webhooks/clerk — config + signature gate', () => {
  test('501 when CLERK_WEBHOOK_SECRET is unconfigured', async () => {
    getClerkWebhookSecret = mock(() => undefined)

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(501)
    expect(verifyWebhookImpl).not.toHaveBeenCalled()
  })

  test('403 when signature verification fails', async () => {
    verifyWebhookImpl = mock(async () => {
      throw new Error('bad signature')
    })

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(403)
  })
})

describe('POST /api/v1/webhooks/clerk — seat enforcement (organizationMembership.created)', () => {
  test('enterprise plan (seats: null) bypasses the seat check entirely', async () => {
    getPlanForOwner = mock(async () => BILLING_PLANS.enterprise)

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(202)
    expect(getOrganizationMembershipList).not.toHaveBeenCalled()
    expect(deleteOrganizationMembership).not.toHaveBeenCalled()
    expect(logEventImpl).toHaveBeenCalledTimes(1)
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_1',
      userId: 'user_new',
      event: 'member.invited',
      action: 'invite',
      result: 'success',
    })
  })

  test('count === seats (post-addition) fits — the new member is NOT rolled back', async () => {
    getPlanForOwner = mock(async () => BILLING_PLANS.pro) // seats: 3
    getOrganizationMembershipList = mock(async () => membershipsOfSize(3))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(202)
    expect(getOrganizationMembershipList).toHaveBeenCalledWith({
      organizationId: 'org_1',
      limit: 100,
    })
    expect(deleteOrganizationMembership).not.toHaveBeenCalled()
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      result: 'success',
    })
  })

  test('count === seats + 1 (post-addition) is over cap — the new member IS rolled back', async () => {
    getPlanForOwner = mock(async () => BILLING_PLANS.pro) // seats: 3
    getOrganizationMembershipList = mock(async () => membershipsOfSize(4))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(202)
    expect(getOrganizationMembershipList).toHaveBeenCalledWith({
      organizationId: 'org_1',
      limit: 100,
    })
    expect(deleteOrganizationMembership).toHaveBeenCalledTimes(1)
    expect(deleteOrganizationMembership.mock.calls[0]?.[0]).toEqual({
      organizationId: 'org_1',
      userId: 'user_new',
    })
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_1',
      userId: 'user_new',
      event: 'member.invited',
      action: 'invite',
      result: 'denied',
    })
  })
})

describe('POST /api/v1/webhooks/clerk — audit wiring', () => {
  test('organizationMembership.deleted logs a member.removed row', async () => {
    verifyWebhookImpl = mock(async () => ({
      type: 'organizationMembership.deleted',
      data: {
        organization: { id: 'org_1' },
        public_user_data: { user_id: 'user_gone' },
      },
    }))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(202)
    expect(logEventImpl).toHaveBeenCalledTimes(1)
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_1',
      userId: 'user_gone',
      event: 'member.removed',
      action: 'delete',
      result: 'success',
    })
  })
})

describe('POST /api/v1/webhooks/clerk — other event types', () => {
  test('a non-membership event is acknowledged without touching the seat check', async () => {
    verifyWebhookImpl = mock(async () => ({
      type: 'user.created',
      data: {},
    }))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(202)
    expect(getPlanForOwner).not.toHaveBeenCalled()
    expect(getOrganizationMembershipList).not.toHaveBeenCalled()
    expect(deleteOrganizationMembership).not.toHaveBeenCalled()
    expect(logEventImpl).not.toHaveBeenCalled()
  })
})
