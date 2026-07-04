/**
 * Regression: the chart data endpoint must reject malformed hostId at the
 * request boundary with a 400 — not accept it (200) and let it flow to the
 * data layer where `getAndValidateClientConfig` throws a 500.
 *
 * The boundary previously used `!Number.isFinite(hostId)`, which accepts
 * negative (`-1`) and fractional (`1.5`) values — both invalid host indices.
 * The contract (see lib/api/shared/validators/host-id.ts and the newer routes
 * like /api/v1/overview) is: hostId must be a NON-NEGATIVE INTEGER.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
  isAnonymousPublicReadRequest: async () => false,
}))

import * as realRegistry from '@/lib/api/chart-registry'

mock.module('@/lib/api/chart-registry', () => ({
  ...realRegistry,
  hasChart: () => true,
  getAvailableCharts: () => ['c'],
  getChartQuery: () => ({ query: 'SELECT 1', optional: false }),
}))

import * as realExecutor from '@/lib/api/query-executor'

// Benign executor: if validation is (incorrectly) skipped, the handler reaches
// here and returns 200 — which is exactly what we assert must NOT happen for
// malformed ids.
const executeChartQuery = mock(async () => ({
  dataJson: '[]',
  metadata: {},
  error: undefined,
  executedSql: 'SELECT 1',
  clickhouseVersion: null,
}))

mock.module('@/lib/api/query-executor', () => ({
  ...realExecutor,
  executeChartQuery,
}))

const { handler } = await import('@/routes/api/v1/charts/$name')

async function status(hostId: string): Promise<number> {
  const res = await handler(
    new Request(`http://x/api/v1/charts/c?hostId=${hostId}`),
    'c'
  )
  return res.status
}

describe('GET /api/v1/charts/$name — hostId boundary validation', () => {
  beforeEach(() => executeChartQuery.mockClear())

  test('rejects negative hostId with 400', async () => {
    expect(await status('-1')).toBe(400)
    expect(executeChartQuery).not.toHaveBeenCalled()
  })

  test('rejects fractional hostId with 400', async () => {
    expect(await status('1.5')).toBe(400)
    expect(await status('0.1')).toBe(400)
    expect(executeChartQuery).not.toHaveBeenCalled()
  })

  test('rejects non-numeric hostId with 400', async () => {
    expect(await status('abc')).toBe(400)
    expect(await status('NaN')).toBe(400)
    expect(await status('1abc')).toBe(400) // Number('1abc') === NaN
  })

  test('rejects Infinity hostId with 400', async () => {
    expect(await status('Infinity')).toBe(400)
    expect(await status('1e400')).toBe(400) // overflows to Infinity
  })

  test('accepts valid non-negative integer hostIds (reaches executor)', async () => {
    expect(await status('0')).not.toBe(400)
    expect(await status('2')).not.toBe(400)
    expect(executeChartQuery).toHaveBeenCalled()
  })

  test('defaults to host 0 when hostId param is absent', async () => {
    const res = await handler(new Request('http://x/api/v1/charts/c'), 'c')
    expect(res.status).not.toBe(400)
  })
})
