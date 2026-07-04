/**
 * #2172 — route-level regression: GET /api/v1/tables/$name must reject a
 * hand-crafted non-negative `hostId` for an authenticated cloud principal
 * (the hidden demo host), while leaving OSS and anonymous-cloud callers
 * unaffected. Mirrors charts/__tests__/cloud-demo-host-guard.test.ts. See
 * lib/cloud/reject-demo-host.ts for the unit-level coverage of the underlying
 * boolean logic.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

let cloudMode = false
let signedIn = false

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
    get CHM_CLOUD_MODE() {
      return cloudMode ? 'true' : 'false'
    },
  },
}))

import * as realProvider from '@/lib/auth/provider'

mock.module('@/lib/auth/provider', () => ({
  ...realProvider,
  isClerkAuthProvider: () => true,
}))

mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => (signedIn ? { userId: 'user_123' } : { userId: null }),
}))

import * as realRegistry from '@/lib/api/table-registry'

mock.module('@/lib/api/table-registry', () => ({
  ...realRegistry,
  hasTable: () => true,
  getAvailableTables: () => ['t'],
  getTableQuery: () => ({
    queryConfig: { name: 't', sql: 'SELECT 1' },
    queryParams: {},
  }),
}))

import * as realExecutor from '@/lib/api/query-executor'

const executeTableConfig = mock(async () => ({
  result: { data: [], metadata: {} },
  executedSql: 'SELECT 1',
  clickhouseVersion: null,
}))

mock.module('@/lib/api/query-executor', () => ({
  ...realExecutor,
  executeTableConfig,
}))

const { handler } = await import('@/routes/api/v1/tables/$name')

async function get(hostId: string) {
  return handler(new Request(`http://x/api/v1/tables/t?hostId=${hostId}`), 't')
}

describe('GET /api/v1/tables/$name — cloud demo-host guard (#2172)', () => {
  beforeEach(() => {
    cloudMode = false
    signedIn = false
    executeTableConfig.mockClear()
  })

  test('OSS: authenticated caller + hostId=0 is unaffected (reaches executor)', async () => {
    cloudMode = false
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(executeTableConfig).toHaveBeenCalled()
  })

  test('anonymous cloud: hostId=0 is unaffected (reaches executor)', async () => {
    cloudMode = true
    signedIn = false
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(executeTableConfig).toHaveBeenCalled()
  })

  test('authenticated cloud + hostId=0: rejected with structured empty response', async () => {
    cloudMode = true
    signedIn = true
    const res = await get('0')
    expect(res.status).toBe(200)
    expect(executeTableConfig).not.toHaveBeenCalled()
    const body = (await res.json()) as {
      success: boolean
      data: unknown[]
      metadata: { unavailable: boolean }
    }
    expect(body.success).toBe(true)
    expect(body.data).toEqual([])
    expect(body.metadata.unavailable).toBe(true)
  })

  test('authenticated cloud + negative hostId is invalid at this route boundary (400)', async () => {
    cloudMode = true
    signedIn = true
    const res = await get('-1')
    expect(res.status).toBe(400)
  })
})
