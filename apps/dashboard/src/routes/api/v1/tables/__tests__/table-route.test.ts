/**
 * GET /api/v1/tables/$name:
 *
 * - Feature permissions: when Clerk public read is on, the API middleware lets
 *   every /api/v1/* request through and relies on each route's own
 *   `authorizeFeatureRequest`. The table route must therefore enforce
 *   CHM_DISABLED_FEATURES / CHM_AUTH_REQUIRED_FEATURES itself, exactly like
 *   the chart route, or a feature the operator turned off still serves data.
 * - #3738: a query failure keeps its classification (400/403/404/503/504)
 *   instead of collapsing to a 500, so the UI and monitoring can tell a caller
 *   or ClickHouse-side problem from a server fault.
 * - An optional config whose backing table is missing degrades to a 200
 *   `unavailable` answer (the page renders "Table not available").
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const envVars: Record<string, string | undefined> = {}

mock.module('cloudflare:workers', () => ({ env: envVars }))

let signedIn = false
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => (signedIn ? { userId: 'user_123' } : { userId: null }),
}))

import type { FeaturePermission } from '@/lib/feature-permissions/types'

let permission: FeaturePermission | undefined
let optional = false

import * as realRegistry from '@/lib/api/table-registry'

mock.module('@/lib/api/table-registry', () => ({
  ...realRegistry,
  hasTable: () => true,
  getAvailableTables: () => ['t'],
  getTableQuery: () => ({
    queryConfig: { name: 't', sql: 'SELECT 1', permission, optional },
    queryParams: {},
  }),
}))

import * as realExecutor from '@/lib/api/query-executor'

type ExecResult = {
  result: {
    data?: unknown[]
    metadata: Record<string, unknown>
    error?: { type: string; message: string; details?: unknown }
  }
  executedSql: string
  clickhouseVersion: string | null
  maxResultRows: number
}

let execImpl: () => Promise<ExecResult> = async () => ({
  result: { data: [{ a: 1 }], metadata: { rows: 1 } },
  executedSql: 'SELECT 1',
  clickhouseVersion: null,
  maxResultRows: 0,
})
const executeTableConfig = mock(() => execImpl())

mock.module('@/lib/api/query-executor', () => ({
  ...realExecutor,
  executeTableConfig,
}))

const { _resetAppConfigCache } = await import(
  '@/lib/feature-permissions/server'
)
const { handler } = await import('@/routes/api/v1/tables/$name')

function get() {
  return handler(new Request('http://x/api/v1/tables/t?hostId=0'), 't')
}

function failWith(type: string, message = 'boom') {
  execImpl = async () => ({
    result: { metadata: {}, error: { type, message } },
    executedSql: 'SELECT 1',
    clickhouseVersion: null,
    maxResultRows: 0,
  })
}

function resetEnv() {
  for (const key of Object.keys(envVars)) delete envVars[key]
  envVars.CLICKHOUSE_HOST = 'http://localhost:8123'
  envVars.CLICKHOUSE_USER = 'default'
  envVars.CLICKHOUSE_PASSWORD = ''
}

beforeEach(() => {
  resetEnv()
  signedIn = false
  permission = undefined
  optional = false
  execImpl = async () => ({
    result: { data: [{ a: 1 }], metadata: { rows: 1 } },
    executedSql: 'SELECT 1',
    clickhouseVersion: null,
    maxResultRows: 0,
  })
  executeTableConfig.mockClear()
  _resetAppConfigCache()
})

afterEach(() => {
  _resetAppConfigCache()
})

describe('GET /api/v1/tables/$name — feature permissions', () => {
  test('disabled feature → 404 FEATURE_DISABLED, query never runs', async () => {
    permission = { feature: 'queries' }
    envVars.CHM_DISABLED_FEATURES = 'queries'
    const res = await get()
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code?: string } }
    expect(JSON.stringify(body)).toContain('FEATURE_DISABLED')
    expect(executeTableConfig).not.toHaveBeenCalled()
  })

  test('auth-required feature + anonymous (Clerk public read) → 401', async () => {
    permission = { feature: 'queries' }
    envVars.CHM_AUTH_PROVIDER = 'clerk'
    envVars.CHM_CLERK_PUBLIC_READ = 'true'
    envVars.CHM_AUTH_REQUIRED_FEATURES = 'queries'
    const res = await get()
    expect(res.status).toBe(401)
    expect(executeTableConfig).not.toHaveBeenCalled()
  })

  test('auth-required feature + signed-in caller → 200', async () => {
    permission = { feature: 'queries' }
    envVars.CHM_AUTH_PROVIDER = 'clerk'
    envVars.CHM_CLERK_PUBLIC_READ = 'true'
    envVars.CHM_AUTH_REQUIRED_FEATURES = 'queries'
    signedIn = true
    const res = await get()
    expect(res.status).toBe(200)
    expect(executeTableConfig).toHaveBeenCalled()
  })

  test('allowed feature → 200', async () => {
    permission = { feature: 'queries' }
    envVars.CHM_DISABLED_FEATURES = 'settings'
    const res = await get()
    expect(res.status).toBe(200)
  })
})

describe('GET /api/v1/tables/$name — error status mapping (#3738)', () => {
  const cases: Array<[string, number]> = [
    ['validation_error', 400],
    ['permission_error', 403],
    ['table_not_found', 404],
    ['column_not_found', 404],
    ['network_error', 503],
    ['ssl_error', 503],
    ['timeout_error', 504],
    ['query_error', 500],
  ]
  for (const [type, status] of cases) {
    test(`${type} → ${status}`, async () => {
      failWith(type)
      const res = await get()
      expect(res.status).toBe(status)
      const body = (await res.json()) as {
        success: boolean
        error: { type: string }
      }
      expect(body.success).toBe(false)
      expect(body.error.type).toBe(type)
    })
  }

  test('thrown timeout exception → 504, unknown exception → 500', async () => {
    execImpl = async () => {
      throw new Error('Timeout exceeded: elapsed 30 seconds')
    }
    expect((await get()).status).toBe(504)
    execImpl = async () => {
      throw new Error('something odd happened')
    }
    expect((await get()).status).toBe(500)
  })

  test('optional config + missing table → 200 unavailable', async () => {
    optional = true
    failWith('table_not_found', 'Table system.backup_log does not exist')
    const res = await get()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: unknown[]
      metadata: { unavailable: boolean; unavailableReason: string }
    }
    expect(body.data).toEqual([])
    expect(body.metadata.unavailable).toBe(true)
    expect(typeof body.metadata.unavailableReason).toBe('string')
  })

  test('non-optional config + missing table → 404', async () => {
    failWith('table_not_found')
    expect((await get()).status).toBe(404)
  })
})
