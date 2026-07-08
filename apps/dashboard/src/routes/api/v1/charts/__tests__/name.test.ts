/**
 * Tests for the GET /api/v1/charts/$name handler, focused on graceful
 * degradation when an *optional* chart's backing table is missing.
 *
 * Regression for the production bug where the overview page fired hard 500s
 * (and use-chart-data retried each 3x) for charts like `thread-utilization`
 * whenever `system.query_thread_log` was disabled on the target ClickHouse.
 */

import type { FetchDataError } from '@chm/clickhouse-client'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

// Feature gate always allows in these tests. `isAnonymousPublicReadRequest`
// (used by the shared edge-cache gate, #2181) is stubbed `false` — these
// tests aren't exercising caching behavior, so the route should skip the
// edge cache entirely and just run its normal response path.
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
  isAnonymousPublicReadRequest: async () => false,
}))

// Controllable chart registry: an optional chart and a non-optional one. Spread
// the real module first so other named exports (registerChartQuery, ...) survive
// bun's global module mock.
import * as realRegistry from '@/lib/api/chart-registry'

mock.module('@/lib/api/chart-registry', () => ({
  ...realRegistry,
  hasChart: (n: string) => n === 'opt-chart' || n === 'plain-chart',
  getAvailableCharts: () => ['opt-chart', 'plain-chart'],
  getChartQuery: (n: string) =>
    n === 'opt-chart'
      ? {
          query: 'SELECT 1 FROM system.query_thread_log',
          optional: true,
          tableCheck: 'system.query_thread_log',
        }
      : { query: 'SELECT 1', optional: false },
}))

// Controllable executor: real exports preserved, executeChartQuery overridden.
import * as realExecutor from '@/lib/api/query-executor'

const mockExecuteChartQuery = mock(
  async (): Promise<{
    dataJson: string | null
    metadata: Record<string, string | number>
    error?: FetchDataError
    executedSql: string
    clickhouseVersion: string | null
  }> => ({
    dataJson: '[]',
    metadata: {},
    error: undefined,
    executedSql: 'SELECT 1',
    clickhouseVersion: null,
  })
)
mock.module('@/lib/api/query-executor', () => ({
  ...realExecutor,
  executeChartQuery: mockExecuteChartQuery,
}))

const tableNotFound: FetchDataError = {
  type: 'table_not_found',
  message: 'Missing required tables: system.query_thread_log',
  details: { missingTables: ['system.query_thread_log'] },
}

const realQueryError: FetchDataError = {
  type: 'query_error',
  message:
    '(total) memory limit exceeded: would use 1.35 GiB ... MEMORY_LIMIT_EXCEEDED',
}

// The production "api 500" report: an unreachable upstream surfaces as a
// Cloudflare 525, classified upstream as ssl_error.
const upstreamDownError: FetchDataError = {
  type: 'ssl_error',
  message: 'error code: 525\n (host: https://ch.example:8443)',
  details: { httpStatusCode: 525 },
}

async function call(name: string): Promise<Response> {
  const { handler } = await import('../$name')
  return handler(
    new Request(`http://localhost/api/v1/charts/${name}?hostId=0`),
    name
  )
}

describe('GET /api/v1/charts/$name — optional table degradation', () => {
  beforeEach(() => {
    mockExecuteChartQuery.mockClear()
  })

  test('optional chart with missing table → 200 empty + unavailable note (not 500)', async () => {
    mockExecuteChartQuery.mockResolvedValueOnce({
      dataJson: null,
      metadata: {},
      error: tableNotFound,
      executedSql: 'SELECT 1 FROM system.query_thread_log',
      clickhouseVersion: null,
    })

    const response = await call('opt-chart')
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      success: boolean
      data: unknown[]
      metadata: {
        unavailable?: { reason: string; missingTables: string[] }
      }
    }
    expect(body.success).toBe(true)
    expect(body.data).toEqual([])
    expect(body.metadata.unavailable?.reason).toBe('table_not_found')
    expect(body.metadata.unavailable?.missingTables).toContain(
      'system.query_thread_log'
    )
  })

  test('optional chart with a REAL query error still → 500 (errors not swallowed)', async () => {
    mockExecuteChartQuery.mockResolvedValueOnce({
      dataJson: null,
      metadata: {},
      error: realQueryError,
      executedSql: 'SELECT 1',
      clickhouseVersion: null,
    })

    const response = await call('opt-chart')
    expect(response.status).toBe(500)

    const body = (await response.json()) as {
      success: boolean
      error: { type: string; message: string }
      metadata?: { sql?: string }
    }
    expect(body.success).toBe(false)
    expect(body.error.type).toBe('query_error')
    // SQL stays available so empty/error cards can open "review query".
    expect(body.metadata?.sql).toBe('SELECT 1')
  })

  test('unreachable upstream (525/ssl_error) → 503, not 500', async () => {
    mockExecuteChartQuery.mockResolvedValueOnce({
      dataJson: null,
      metadata: {},
      error: upstreamDownError,
      executedSql: 'SELECT 1',
      clickhouseVersion: null,
    })

    const response = await call('plain-chart')
    // 503 (retryable) is correct for a down upstream — a 500 wrongly implies an
    // application fault and is what the production report flagged.
    expect(response.status).toBe(503)
    const body = (await response.json()) as {
      success: boolean
      error: { type: string }
    }
    expect(body.success).toBe(false)
    expect(body.error.type).toBe('ssl_error')
  })

  test('non-optional chart with table_not_found is NOT degraded → 404 (not swallowed)', async () => {
    mockExecuteChartQuery.mockResolvedValueOnce({
      dataJson: null,
      metadata: {},
      error: tableNotFound,
      executedSql: 'SELECT 1',
      clickhouseVersion: null,
    })

    const response = await call('plain-chart')
    // A missing table is a non-retryable 404 (preserved error type), not the
    // 200-empty degradation path reserved for *optional* charts.
    expect(response.status).toBe(404)
    const body = (await response.json()) as {
      success: boolean
      error: { type: string }
    }
    expect(body.success).toBe(false)
    expect(body.error.type).toBe('table_not_found')
  })

  test('healthy optional chart returns data normally → 200', async () => {
    mockExecuteChartQuery.mockResolvedValueOnce({
      dataJson: '[{"x":1}]',
      metadata: { rows: 1, duration: 5 },
      error: undefined,
      executedSql: 'SELECT 1 FROM system.query_thread_log',
      clickhouseVersion: '24.1',
    })

    const response = await call('opt-chart')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      success: boolean
      data: { x: number }[]
    }
    expect(body.success).toBe(true)
    expect(body.data).toEqual([{ x: 1 }])
  })

  test('unknown chart → 404', async () => {
    const response = await call('does-not-exist')
    expect(response.status).toBe(404)
  })
})
