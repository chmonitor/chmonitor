/**
 * Feature gates on the registry-backed data routes that sit beside
 * /api/v1/charts/$name and /api/v1/tables/$name:
 *
 *   - POST /api/v1/data (with a queryConfigName)
 *   - POST /api/v1/browser-connections/tables/$name
 *   - POST /api/v1/browser-connections/charts/$name
 *
 * With Clerk public read on, the API middleware passes every /api/v1/* request
 * and leaves per-feature enforcement to the route. Browser-connection callers
 * bring their own ClickHouse credentials, but a feature the operator disabled
 * (CHM_DISABLED_FEATURES) or restricted (CHM_AUTH_REQUIRED_FEATURES) must stay
 * disabled/restricted on these routes too — otherwise turning a feature off
 * only hides its page while its data keeps flowing.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

const envVars: Record<string, string | undefined> = {}
mock.module('cloudflare:workers', () => ({ env: envVars }))

let signedIn = false
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => (signedIn ? { userId: 'user_123' } : { userId: null }),
}))

import type { FeaturePermission } from '@/lib/feature-permissions/types'

const permission: FeaturePermission = { feature: 'queries' }

// Registry lookups: every name resolves to a config gated on `queries`.
import * as realQueryConfig from '@/lib/query-config'

mock.module('@/lib/query-config', () => ({
  ...realQueryConfig,
  getQueryConfigByName: () => ({ name: 't', sql: 'SELECT 1', permission }),
}))

import * as realPacks from '@/lib/query-config/declarative/pack-registry'

mock.module('@/lib/query-config/declarative/pack-registry', () => ({
  ...realPacks,
  ensurePacksLoaded: async () => {},
}))

import * as realChartRegistry from '@/lib/api/chart-registry'

mock.module('@/lib/api/chart-registry', () => ({
  ...realChartRegistry,
  hasChart: () => true,
  getChartQuery: () => ({ query: 'SELECT 1', permission }),
}))

import * as realTableRegistry from '@/lib/api/table-registry'

mock.module('@/lib/api/table-registry', () => ({
  ...realTableRegistry,
  getTableConfig: () => ({ name: 't', sql: 'SELECT 1', permission }),
}))

// Credentials + execution stubs: the gate is what is under test.
mock.module('@/lib/connection-query/resolve-credentials', () => ({
  resolveProxyCredentials: async () => ({
    host: 'http://ch.example.com:8123',
    user: 'u',
    password: 'p',
  }),
}))

const executeConnectionTableConfig = mock(async () => ({
  data: [{ a: 1 }],
  metadata: { rows: 1 },
}))
mock.module('@/lib/connection-query/execute-connection-table', () => ({
  executeConnectionTableConfig,
}))

const executeConnectionChartQuery = mock(async () => ({
  data: [{ a: 1 }],
  metadata: { rows: 1 },
  executedSql: 'SELECT 1',
}))
mock.module('@/lib/connection-query/execute-connection-chart', () => ({
  executeConnectionChartQuery,
}))

import * as realClient from '@chm/clickhouse-client'

const fetchData = mock(async () => ({
  data: [{ a: 1 }],
  metadata: { queryId: '', duration: 0, rows: 1, host: '0' },
}))
mock.module('@chm/clickhouse-client', () => ({ ...realClient, fetchData }))

const { _resetAppConfigCache } = await import(
  '@/lib/feature-permissions/server'
)
const { handlePost: browserTablePost } = await import(
  '@/routes/api/v1/browser-connections/tables/$name'
)
const { handlePost: browserChartPost } = await import(
  '@/routes/api/v1/browser-connections/charts/$name'
)
const { handlePost: dataPost } = await import('@/routes/api/v1/data')

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const routes: Array<{
  name: string
  call: () => Promise<Response>
  ran: () => number
}> = [
  {
    name: 'browser-connections/tables/$name',
    call: () =>
      browserTablePost(
        jsonRequest('http://x/api/v1/browser-connections/tables/t', {
          sessionToken: 'tok',
        }),
        't'
      ),
    ran: () => executeConnectionTableConfig.mock.calls.length,
  },
  {
    name: 'browser-connections/charts/$name',
    call: () =>
      browserChartPost(
        jsonRequest('http://x/api/v1/browser-connections/charts/c', {
          sessionToken: 'tok',
        }),
        'c'
      ),
    ran: () => executeConnectionChartQuery.mock.calls.length,
  },
  {
    name: 'data (queryConfigName)',
    call: () =>
      dataPost(
        jsonRequest('http://x/api/v1/data', {
          query: 'SELECT 1',
          hostId: '0',
          queryConfigName: 't',
        })
      ),
    ran: () => fetchData.mock.calls.length,
  },
]

beforeEach(() => {
  for (const key of Object.keys(envVars)) delete envVars[key]
  envVars.CLICKHOUSE_HOST = 'http://localhost:8123'
  envVars.CLICKHOUSE_USER = 'default'
  envVars.CLICKHOUSE_PASSWORD = ''
  signedIn = false
  executeConnectionTableConfig.mockClear()
  executeConnectionChartQuery.mockClear()
  fetchData.mockClear()
  _resetAppConfigCache()
})

for (const route of routes) {
  describe(`POST /api/v1/${route.name} — feature permissions`, () => {
    test('disabled feature → 404, query never runs', async () => {
      envVars.CHM_DISABLED_FEATURES = 'queries'
      const res = await route.call()
      expect(res.status).toBe(404)
      expect(await res.text()).toContain('FEATURE_DISABLED')
      expect(route.ran()).toBe(0)
    })

    test('auth-required feature + anonymous (Clerk public read) → 401', async () => {
      envVars.CHM_AUTH_PROVIDER = 'clerk'
      envVars.CHM_CLERK_PUBLIC_READ = 'true'
      envVars.CHM_AUTH_REQUIRED_FEATURES = 'queries'
      const res = await route.call()
      expect(res.status).toBe(401)
      expect(route.ran()).toBe(0)
    })

    test('allowed feature → 200', async () => {
      envVars.CHM_DISABLED_FEATURES = 'settings'
      const res = await route.call()
      expect(res.status).toBe(200)
      expect(route.ran()).toBe(1)
    })
  })
}
