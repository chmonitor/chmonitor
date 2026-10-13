/**
 * WHY: POST /api/v1/charts/batch used to await authorizeFeatureRequest once
 * per chart. A grouping of N charts sharing one permission paid N auth calls
 * (Clerk lookups on a cold path). Each distinct permission is now checked
 * once, and a denial still blocks the whole grouping with the same response.
 */

import type { FeaturePermission } from '@/lib/feature-permissions/types'

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realRegistry from '@/lib/api/chart-registry'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

const READ: FeaturePermission = { feature: 'schema', operation: 'read' }
const WRITE: FeaturePermission = { feature: 'schema', operation: 'write' }

// The third chart of the grouping gets WRITE, every other chart READ, so the
// repeated READ permissions are non-adjacent.
// Captured before mock.module: the namespace import is live-bound to the mock.
const realGetChartQuery = realRegistry.getChartQuery
let chartIndex = 0
mock.module('@/lib/api/chart-registry', () => ({
  ...realRegistry,
  getChartQuery: (name: string, opts: unknown) => {
    const def = realGetChartQuery(name, opts as never)
    if (!def) return def
    return { ...def, permission: chartIndex++ === 2 ? WRITE : READ }
  },
}))

// Authorization is under test, not execution: skip the ClickHouse round-trips.
import * as realBatch from '@/lib/api/chart-batch'

mock.module('@/lib/api/chart-batch', () => ({
  ...realBatch,
  executeChartGrouping: async () => ({}),
}))

let calls = 0
let denied: FeaturePermission['operation'] | null = null
const seen: Array<FeaturePermission | undefined> = []
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async (permission?: FeaturePermission) => {
    calls++
    seen.push(permission)
    if (denied && permission?.operation === denied) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
    return null
  },
  isAnonymousPublicReadRequest: async () => false,
}))

mock.module('@/lib/cloud/reject-demo-host', () => ({
  isDemoHostBlockedForRequest: async () => false,
}))

const { handler } = await import('../batch')

function post(): Promise<Response> {
  return handler(
    new Request('http://localhost/api/v1/charts/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupingId: 'insights-stats', hostId: 0 }),
    })
  )
}

describe('POST /api/v1/charts/batch authorization', () => {
  beforeEach(() => {
    calls = 0
    chartIndex = 0
    denied = null
    seen.length = 0
  })

  test('charts sharing a permission authorize once per distinct permission', async () => {
    await post().catch(() => undefined)
    expect(calls).toBe(2)
    expect(seen.map((p) => p?.operation).sort()).toEqual(['read', 'write'])
  })

  test('a denied permission still denies the grouping with its own response', async () => {
    denied = 'write'
    const res = await post()
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })
})
