/**
 * The Access matrix configs read every user's grants, so turning the
 * `security` feature off must stop them on /api/v1/data, not just hide the
 * page. Unlike feature-permission-gates.test.ts this uses the REAL query
 * config registry, so it fails if a config loses its `permission`.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

const envVars: Record<string, string | undefined> = {}
mock.module('cloudflare:workers', () => ({ env: envVars }))
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => ({ userId: null }),
}))

import * as realPacks from '@/lib/query-config/declarative/pack-registry'

mock.module('@/lib/query-config/declarative/pack-registry', () => ({
  ...realPacks,
  ensurePacksLoaded: async () => {},
}))

import * as realClient from '@chm/clickhouse-client'

const fetchData = mock(async () => ({
  data: [],
  metadata: { queryId: '', duration: 0, rows: 0, host: '0' },
}))
mock.module('@chm/clickhouse-client', () => ({ ...realClient, fetchData }))

const { _resetAppConfigCache } = await import(
  '@/lib/feature-permissions/server'
)
const { handlePost: dataPost } = await import('@/routes/api/v1/data')
const { accessMatrixConfigs } = await import(
  '@/lib/query-config/security/access-matrix'
)

const post = (queryConfigName: string) =>
  dataPost(
    new Request('http://x/api/v1/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostId: 0, queryConfigName }),
    })
  )

beforeEach(() => {
  for (const key of Object.keys(envVars)) delete envVars[key]
  envVars.CLICKHOUSE_HOST = 'http://localhost:8123'
  envVars.CLICKHOUSE_USER = 'default'
  envVars.CLICKHOUSE_PASSWORD = ''
  fetchData.mockClear()
  _resetAppConfigCache()
})

describe('POST /api/v1/data — access matrix behind the security feature', () => {
  for (const { name } of accessMatrixConfigs) {
    test(`CHM_DISABLED_FEATURES=security blocks ${name}`, async () => {
      envVars.CHM_DISABLED_FEATURES = 'security'
      const res = await post(name)
      expect(res.status).toBe(404)
      expect(await res.text()).toContain('FEATURE_DISABLED')
      expect(fetchData.mock.calls.length).toBe(0)
    })
  }

  test('access-grants still runs when another feature is disabled', async () => {
    envVars.CHM_DISABLED_FEATURES = 'settings'
    const res = await post('access-grants')
    expect(res.status).toBe(200)
    expect(fetchData.mock.calls.length).toBe(1)
  })
})
