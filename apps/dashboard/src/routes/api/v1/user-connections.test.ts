/**
 * Tests for POST /api/v1/user-connections — focused on the audit wiring added
 * for plans/22-audit-log-export.md (connection.created, success and denied).
 * The route's pre-existing host-limit/SSRF/store logic is not otherwise
 * covered by an existing test file; these tests exercise the real handler
 * end to end with every I/O collaborator mocked.
 *
 * `@/lib/audit/logEvent` is mocked at its LEAF specifier, never the
 * `@/lib/audit` barrel (see the same note in webhooks/clerk.test.ts) — a
 * partial barrel mock here would shadow listAuditLogs/buildAuditCsv for
 * routes/api/v1/audit/export.test.ts when both share a `bun test src/
 * --isolate` process. `@/lib/billing/user-subscription` is mocked with its
 * full real export surface because webhooks/clerk.test.ts also mocks this
 * same specifier with a different subset — a superset keeps registration
 * order-independent regardless of load order.
 */

import type { BillingOwner } from '@/lib/billing/billing-owner'

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { BILLING_PLANS } from '@/lib/billing/plans'

let logEventImpl = mock((_e: unknown) => Promise.resolve())
mock.module('@/lib/audit/logEvent', () => ({
  logEvent: (e: unknown) => logEventImpl(e),
}))

mock.module('@/lib/connection-store/server-feature', () => ({
  getUserConnectionsServerConfig: () => ({
    dbStorageEnabled: true,
    requiresAuth: true,
    encryptionConfigured: true,
  }),
}))

let resolveConnectionUserId = mock(async () => 'user_1')
mock.module('@/lib/connection-store/auth', () => ({
  GUEST_USER_ID: 'guest',
  resolveConnectionUserId: () => resolveConnectionUserId(),
}))

let resolveBillingOwner = mock(
  async (): Promise<BillingOwner> => ({
    type: 'org',
    id: 'org_1',
  })
)
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: () => resolveBillingOwner(),
}))

let getPlanForOwner = mock(async (_ownerId: string) => BILLING_PLANS.pro)
mock.module('@/lib/billing/user-subscription', () => ({
  isSubscriptionLive: () => true,
  resolveOwnerSubscription: async () => null,
  getPlanIdForOwner: async () => 'free' as const,
  getPlanForOwner: (ownerId: string) => getPlanForOwner(ownerId),
  getUserPlanId: async () => 'free' as const,
  getUserPlan: async () => BILLING_PLANS.free,
}))

let countOwnerHosts = mock(async () => ({
  count: 0,
  memberUserIds: ['user_1'],
}))
mock.module('@/lib/billing/org-host-count', () => ({
  countOwnerHosts: () => countOwnerHosts(),
}))

mock.module('@/lib/browser-connections/host-url', () => ({
  validateHostUrl: async (_host: string) => null,
  createHostValidationFetch: () => fetch,
}))

let queryConnection = mock(async (_creds: unknown, _sql: string) => [])
mock.module('@/lib/connection-query/connection-client', () => ({
  createConnectionClient: () => ({}),
  queryConnection: (creds: unknown, sql: string) => queryConnection(creds, sql),
  getConnectionVersion: async () => null,
}))

let storeCreate = mock(
  async (_userId: string, input: { name: string }, _limit?: unknown) => ({
    id: 'conn_new',
    hostId: -1000,
    name: input.name,
    hostUrl: 'https://ch.example.com',
    chUser: 'default',
    createdAt: 1,
    updatedAt: 1,
  })
)
mock.module('@/lib/connection-store/resolve-store', () => ({
  resolveConnectionStore: async () => ({
    list: async () => [],
    get: async () => null,
    create: (userId: string, input: { name: string }, limit?: unknown) =>
      storeCreate(userId, input, limit),
    update: async () => {
      throw new Error('not used in this test file')
    },
    delete: async () => {},
    getCredentials: async () => null,
  }),
}))

const { __handlePostForTests: handlePost } = await import('./user-connections')

function makeRequest(): Request {
  return new Request('https://dash.example.com/api/v1/user-connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'my-conn',
      host: 'https://ch.example.com:8443',
      user: 'default',
      password: 'secret',
    }),
  })
}

beforeEach(() => {
  logEventImpl = mock(() => Promise.resolve())
  resolveConnectionUserId = mock(async () => 'user_1')
  resolveBillingOwner = mock(
    async (): Promise<BillingOwner> => ({
      type: 'org',
      id: 'org_1',
    })
  )
  getPlanForOwner = mock(async () => BILLING_PLANS.pro)
  countOwnerHosts = mock(async () => ({ count: 0, memberUserIds: ['user_1'] }))
  queryConnection = mock(async () => [])
  storeCreate = mock(
    async (_userId: string, input: { name: string }, _limit?: unknown) => ({
      id: 'conn_new',
      hostId: -1000,
      name: input.name,
      hostUrl: 'https://ch.example.com',
      chUser: 'default',
      createdAt: 1,
      updatedAt: 1,
    })
  )
})

describe('POST /api/v1/user-connections — audit wiring', () => {
  test('a successful create (org owner, under the host cap) logs connection.created:success', async () => {
    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(logEventImpl).toHaveBeenCalledTimes(1)
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_1',
      userId: 'user_1',
      event: 'connection.created',
      resource: 'conn_new',
      action: 'create',
      result: 'success',
    })
  })

  test('a host-limit denial (over cap) logs connection.created:denied instead of creating', async () => {
    countOwnerHosts = mock(async () => ({
      count: BILLING_PLANS.pro.hosts as number,
      memberUserIds: ['user_1'],
    }))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(402)
    expect(storeCreate).not.toHaveBeenCalled()
    expect(logEventImpl).toHaveBeenCalledTimes(1)
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_1',
      event: 'connection.created',
      action: 'create',
      result: 'denied',
    })
  })

  test('a user-scoped owner (no active Clerk org) is never audit-logged', async () => {
    resolveBillingOwner = mock(async () => ({
      type: 'user' as const,
      id: 'user_1',
    }))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(logEventImpl).not.toHaveBeenCalled()
  })
})
