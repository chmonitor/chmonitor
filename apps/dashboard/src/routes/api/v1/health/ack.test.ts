/**
 * #3498 — ACK writes are honest. With no D1/Postgres backend an ACK or un-ACK
 * would be discarded, so POST/DELETE answer 501 instead of confirming a write
 * that never happened, and never touch the store. GET stays fail-open.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('@/lib/feature-permissions/server', () => ({
  getAppConfig: () => ({ authProvider: 'none' as const, features: {} }),
  _resetAppConfigCache: () => {},
  publicReadEnabled: () => true,
  authorizeFeatureRequest: async () => null,
}))

mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: async () => ({ id: 'operator' }),
}))

let backend: 'd1' | 'postgres' | null = null
mock.module('@/lib/health/resolve-store', () => ({
  resolveHealthBackend: () => backend,
  getHealthDb: () => null,
}))

const ackCalls: unknown[] = []
const clearCalls: unknown[] = []
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
  listActiveAcks: async () => [],
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
  ackCalls.length = 0
  clearCalls.length = 0
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
    expect(await res.json()).toEqual({ success: true, acks: [] })
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
