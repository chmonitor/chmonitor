/**
 * #3498 — ACK writes are honest. With no D1/Postgres backend an ACK or un-ACK
 * would be discarded, so POST/DELETE answer 501 instead of confirming a write
 * that never happened, and never touch the store. GET stays fail-open.
 */

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

const realFeaturePermissions = {
  ...(await import('@/lib/feature-permissions/server')),
}
mock.module('@/lib/feature-permissions/server', () => ({
  getAppConfig: () => ({ authProvider: 'none' as const, features: {} }),
  _resetAppConfigCache: () => {},
  publicReadEnabled: () => true,
  authorizeFeatureRequest: async () => null,
}))

let billingOwnerId: string | null = 'operator'
const realBillingOwner = { ...(await import('@/lib/billing/billing-owner')) }
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: async () => {
    if (billingOwnerId === null) throw new Error('UNAUTHORIZED')
    return { id: billingOwnerId }
  },
}))

let backend: 'd1' | 'postgres' | null = null
const realResolveStore = { ...(await import('@/lib/health/resolve-store')) }
mock.module('@/lib/health/resolve-store', () => ({
  resolveHealthBackend: () => backend,
  getHealthDb: () => null,
}))

const ackCalls: unknown[] = []
const clearCalls: unknown[] = []
const listCalls: string[] = []
const realAlertAckStore = { ...(await import('@/lib/health/alert-ack-store')) }
mock.module('@/lib/health/alert-ack-store', () => ({
  isAckDurationKey: (v: unknown) =>
    v === '5m' || v === '15m' || v === '60m' || v === '240m',
  ackAlert: async (params: Record<string, unknown>) => {
    ackCalls.push(params)
    return { ...params, ackedAt: 1, expiresAt: 2, note: '' }
  },
  clearAck: async (...args: unknown[]) => {
    clearCalls.push(args)
  },
  listActiveAcks: async (ownerId: string) => {
    listCalls.push(ownerId)
    return []
  },
}))

const {
  __handlePostForTests: handlePost,
  __handleDeleteForTests: handleDelete,
  __handleGetForTests: handleGet,
} = await import('./ack')

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/v1/health/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const deleteRequest = () =>
  new Request('http://localhost/api/v1/health/ack?hostId=0&ruleId=disk', {
    method: 'DELETE',
  })

beforeEach(() => {
  backend = null
  billingOwnerId = 'operator'
  ackCalls.length = 0
  clearCalls.length = 0
  listCalls.length = 0
  delete process.env.CHM_CLOUD_MODE
  delete process.env.CHM_DEPLOYMENT_MODE
})

describe('POST/DELETE /api/v1/health/ack with no backend (#3498)', () => {
  test('POST is a 501, not a silent success, and writes nothing', async () => {
    const res = await handlePost(
      postRequest({ hostId: 0, ruleId: 'disk', duration: '15m' })
    )
    expect(res.status).toBe(501)
    const body = (await res.json()) as { success: boolean }
    expect(body.success).toBe(false)
    expect(ackCalls).toHaveLength(0)
  })

  test('DELETE is a 501, not a silent success, and clears nothing', async () => {
    const res = await handleDelete(deleteRequest())
    expect(res.status).toBe(501)
    expect(clearCalls).toHaveLength(0)
  })

  test('GET stays fail-open: 200 with an empty list', async () => {
    const res = await handleGet()
    expect(res.status).toBe(200)
    expect((await res.json()) as unknown).toEqual({ success: true, acks: [] })
  })
})

describe('POST/DELETE /api/v1/health/ack with a backend', () => {
  test('POST records the ACK', async () => {
    backend = 'd1'
    const res = await handlePost(
      postRequest({ hostId: 0, ruleId: 'disk', duration: '15m' })
    )
    expect(res.status).toBe(200)
    expect(ackCalls).toHaveLength(1)
  })

  test('DELETE clears the ACK', async () => {
    backend = 'postgres'
    const res = await handleDelete(deleteRequest())
    expect(res.status).toBe(200)
    expect(clearCalls).toHaveLength(1)
  })
})

describe('ACK owner scope (#3897)', () => {
  test('self-hosted reads and writes the single-tenant owner', async () => {
    backend = 'd1'
    await handleGet()
    await handlePost(postRequest({ hostId: 0, ruleId: 'disk', duration: '5m' }))
    await handleDelete(deleteRequest())
    expect(listCalls).toEqual([''])
    expect((ackCalls[0] as { ownerId: string }).ownerId).toBe('')
    expect(clearCalls).toEqual([['', 0, 'disk']])
  })

  test('cloud: anonymous GET is a 401 and reads nothing', async () => {
    process.env.CHM_CLOUD_MODE = 'true'
    billingOwnerId = null
    const res = await handleGet()
    expect(res.status).toBe(401)
    expect(listCalls).toHaveLength(0)
  })

  test('cloud: anonymous POST and DELETE are 401 and write nothing', async () => {
    process.env.CHM_CLOUD_MODE = 'true'
    backend = 'd1'
    billingOwnerId = null
    const post = await handlePost(
      postRequest({ hostId: 0, ruleId: 'disk', duration: '5m' })
    )
    const del = await handleDelete(deleteRequest())
    expect([post.status, del.status]).toEqual([401, 401])
    expect(ackCalls).toHaveLength(0)
    expect(clearCalls).toHaveLength(0)
  })

  test('cloud: a signed-in tenant reads and writes only its own owner', async () => {
    process.env.CHM_CLOUD_MODE = 'true'
    backend = 'd1'
    billingOwnerId = 'org_a'
    await handleGet()
    await handlePost(postRequest({ hostId: 0, ruleId: 'disk', duration: '5m' }))
    await handleDelete(deleteRequest())
    expect(listCalls).toEqual(['org_a'])
    expect((ackCalls[0] as { ownerId: string }).ownerId).toBe('org_a')
    expect(clearCalls).toEqual([['org_a', 0, 'disk']])
  })
})

// Restore the real modules so these mocks never leak into other test files.
afterAll(() => {
  mock.module('@/lib/feature-permissions/server', () => ({
    ...realFeaturePermissions,
  }))
  mock.module('@/lib/billing/billing-owner', () => ({ ...realBillingOwner }))
  mock.module('@/lib/health/resolve-store', () => ({ ...realResolveStore }))
  mock.module('@/lib/health/alert-ack-store', () => ({ ...realAlertAckStore }))
})
