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

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
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
// Superset mock: exports the FULL real surface of billing-owner.ts (both
// resolveBillingOwner and resolveBillingOwnerId). checkout.test.ts also mocks
// this specifier and imports resolveBillingOwnerId; under a single-process
// `bun test` run the last registration wins, so an incomplete mock here would
// leave that route unable to resolve its export (see
// docs/knowledge/billing-checkout-flow.md on mock.module contamination).
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: () => resolveBillingOwner(),
  resolveBillingOwnerId: async () => (await resolveBillingOwner()).id,
}))

let getPlanForOwner = mock(async (_ownerId: string) => BILLING_PLANS.pro)
// Mutable so the active-subscription gate tests can flip a live sub on/off.
// Defaults to null (no sub) — harmless for the non-gate tests because they run
// with cloud mode off, which short-circuits the gate before this is read.
let resolveOwnerSubscription = mock(async (_ownerId: string) => null as unknown)
mock.module('@/lib/billing/user-subscription', () => ({
  isSubscriptionLive: () => true,
  resolveOwnerSubscription: (ownerId: string) =>
    resolveOwnerSubscription(ownerId),
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

let recordHostOverage = mock(async (_ownerId: string, _hosts: number) => {})
mock.module('@/lib/billing/host-usage-store', () => ({
  recordHostOverage: (ownerId: string, hosts: number) =>
    recordHostOverage(ownerId, hosts),
}))

mock.module('@/lib/browser-connections/host-url', () => ({
  validateHostUrl: async (_host: string) => null,
  validatePostgresHost: async (_host: string, _port: number) => null,
  createHostValidationFetch: () => fetch,
}))

let queryConnection = mock(async (_creds: unknown, _sql: string) => [])
mock.module('@/lib/connection-query/connection-client', () => ({
  createConnectionClient: () => ({}),
  queryConnection: (creds: unknown, sql: string) => queryConnection(creds, sql),
  getConnectionVersion: async () => null,
}))

let queryPostgres = mock(async (_conn: unknown, _sql: string) => ({
  rows: [],
  fields: [],
}))
mock.module('@chm/postgres-client', () => ({
  queryPostgres: (conn: unknown, sql: string) => queryPostgres(conn, sql),
  formatPostgresError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
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
  resolveOwnerSubscription = mock(async () => null as unknown)
  countOwnerHosts = mock(async () => ({ count: 0, memberUserIds: ['user_1'] }))
  recordHostOverage = mock(async () => {})
  queryConnection = mock(async () => [])
  queryPostgres = mock(async () => ({ rows: [], fields: [] }))
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

  test('Free hard-caps: a denial (over cap) logs connection.created:denied instead of creating', async () => {
    getPlanForOwner = mock(async () => BILLING_PLANS.free)
    countOwnerHosts = mock(async () => ({
      count: BILLING_PLANS.free.hosts as number,
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

  test('Pro soft-caps: a host past the included allowance is allowed and metered as overage', async () => {
    countOwnerHosts = mock(async () => ({
      count: BILLING_PLANS.pro.hosts as number,
      memberUserIds: ['user_1'],
    }))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(storeCreate).toHaveBeenCalledTimes(1)
    // Soft-capped plans skip the atomic hard limit entirely.
    expect(storeCreate.mock.calls[0]?.[2]).toEqual({
      memberUserIds: ['user_1'],
      limit: null,
    })
    expect(recordHostOverage).toHaveBeenCalledTimes(1)
    expect(recordHostOverage).toHaveBeenCalledWith('org_1', 1)
    expect(logEventImpl).toHaveBeenCalledTimes(1)
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_1',
      event: 'connection.created',
      action: 'create',
      result: 'success',
    })
  })

  test('under the included allowance: no overage is metered', async () => {
    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(recordHostOverage).not.toHaveBeenCalled()
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

describe('POST /api/v1/user-connections — Postgres engine branch', () => {
  function makePostgresRequest(): Request {
    return new Request('https://dash.example.com/api/v1/user-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'my-pg',
        engine: 'postgres',
        host: 'db.example.com',
        port: 5432,
        user: 'postgres',
        password: 'secret',
        database: 'app',
        sslmode: 'require',
      }),
    })
  }

  test('tests via pg, then stores a v2 envelope with engine=postgres', async () => {
    const res = await handlePost(makePostgresRequest())
    expect(res.status).toBe(200)

    // Connectivity was probed through the read-only pg path (SELECT 1).
    expect(queryPostgres).toHaveBeenCalledTimes(1)
    expect(queryPostgres.mock.calls[0]?.[1]).toBe('SELECT 1')

    // The stored input carries the engine + a v2 (kind:'postgres') credential
    // envelope with the Postgres-only fields; hostUrl is the display form.
    expect(storeCreate).toHaveBeenCalledTimes(1)
    const input = storeCreate.mock.calls[0]?.[1] as unknown as {
      engine?: string
      hostUrl: string
      credentials: Record<string, unknown>
    }
    expect(input.engine).toBe('postgres')
    expect(input.hostUrl).toBe('postgres://db.example.com:5432/app')
    expect(input.credentials).toMatchObject({
      kind: 'postgres',
      host: 'db.example.com',
      port: 5432,
      user: 'postgres',
      database: 'app',
      sslmode: 'require',
    })
  })

  test('rejects a Postgres create with no database', async () => {
    const res = await handlePost(
      new Request('https://dash.example.com/api/v1/user-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'my-pg',
          engine: 'postgres',
          host: 'db.example.com',
          user: 'postgres',
          password: 'secret',
        }),
      })
    )
    expect(res.status).toBe(400)
    expect(storeCreate).not.toHaveBeenCalled()
  })
})

// A signed-in cloud user must hold a live subscription (any plan, including the
// $0 Free plan) before their first host can be created. Driven through real
// isCloudModeServer() / isBillingConfigured() by env, not module mocks, so the
// gate wiring itself is exercised end to end.
describe('POST /api/v1/user-connections — active-subscription gate (cloud)', () => {
  const OLD_CLOUD = process.env.CHM_CLOUD_MODE
  const OLD_DEPLOY = process.env.CHM_DEPLOYMENT_MODE
  const OLD_TOKEN = process.env.POLAR_ACCESS_TOKEN

  afterEach(() => {
    restoreEnv('CHM_CLOUD_MODE', OLD_CLOUD)
    restoreEnv('CHM_DEPLOYMENT_MODE', OLD_DEPLOY)
    restoreEnv('POLAR_ACCESS_TOKEN', OLD_TOKEN)
  })

  function restoreEnv(key: string, prev: string | undefined) {
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }

  test('cloud + billing configured, no live subscription → 402 subscription_required, no create', async () => {
    process.env.CHM_CLOUD_MODE = 'true'
    process.env.POLAR_ACCESS_TOKEN = 'polar_oat_test'
    resolveOwnerSubscription = mock(async () => null as unknown)

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(402)
    // Envelope shape (createApiErrorResponse) — the client keys off
    // details.reason === 'subscription_required'.
    const body = (await res.json()) as {
      error: { message: string; details?: { reason?: string } }
    }
    expect(body.error.details?.reason).toBe('subscription_required')
    expect(body.error.message).toBe(
      'An active plan is required before adding a host. Pick a plan on the billing page — Free is $0.'
    )
    expect(storeCreate).not.toHaveBeenCalled()
  })

  test('cloud + a live Free subscription → passes the gate into the normal create flow', async () => {
    process.env.CHM_CLOUD_MODE = 'true'
    process.env.POLAR_ACCESS_TOKEN = 'polar_oat_test'
    resolveOwnerSubscription = mock(async () => ({
      planId: 'free' as const,
      billingPeriod: 'monthly' as const,
      status: 'active',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }))

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(storeCreate).toHaveBeenCalledTimes(1)
  })

  test('OSS / non-cloud mode → gate is skipped even with no subscription (fail open)', async () => {
    delete process.env.CHM_CLOUD_MODE
    delete process.env.CHM_DEPLOYMENT_MODE
    process.env.POLAR_ACCESS_TOKEN = 'polar_oat_test'
    resolveOwnerSubscription = mock(async () => null as unknown)

    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(storeCreate).toHaveBeenCalledTimes(1)
  })
})
