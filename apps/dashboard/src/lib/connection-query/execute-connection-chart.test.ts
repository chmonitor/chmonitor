/**
 * Tests for the multi-query branch of executeConnectionChartQuery — the perf
 * fix that swaps a serial `for await` loop for `Promise.all` so multi-query
 * charts on user/browser connections run in parallel, like the env-host
 * equivalent (`executeMultiChartQuery` in `query-executor.ts`).
 *
 * `queryConnection` is the only I/O boundary here, so only
 * `./connection-client` is mocked (full export surface — mirrors the
 * mock.module style in
 * apps/dashboard/src/routes/api/v1/webhooks/polar.test.ts). The chart
 * registry (`@/lib/api/chart-registry`) is pure in-memory data with no I/O,
 * so these tests register real synthetic charts through its real
 * `registerChartQuery` instead of mocking it, keeping them decoupled from any
 * real production chart's query count.
 */

import type { ConnectionCredentials } from '@/lib/connection-store/types'

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { registerChartQuery } from '@/lib/api/chart-registry'

type QueryConnectionResult = {
  data: Record<string, unknown>[]
  queryId: string | undefined
  duration: number
}

let queryConnection = mock(
  async (
    _credentials: ConnectionCredentials,
    query: string,
    _options?: unknown
  ): Promise<QueryConnectionResult> => ({
    data: [{ query }],
    queryId: undefined,
    duration: 0,
  })
)
mock.module('./connection-client', () => ({
  createConnectionClient: () => ({}),
  getConnectionVersion: async () => null,
  queryConnection: (
    credentials: ConnectionCredentials,
    query: string,
    options?: unknown
  ) => queryConnection(credentials, query, options),
}))

const { executeConnectionChartQuery } = await import(
  './execute-connection-chart'
)

const credentials: ConnectionCredentials = {
  host: 'https://example.com:8443',
  user: 'default',
  password: 'secret',
}

beforeEach(() => {
  queryConnection = mock(
    async (
      _credentials: ConnectionCredentials,
      query: string,
      _options?: unknown
    ): Promise<QueryConnectionResult> => ({
      data: [{ query }],
      queryId: undefined,
      duration: 0,
    })
  )
})

describe('executeConnectionChartQuery — multi-query branch (Promise.all)', () => {
  test('assembles data keyed by each query key, in queries order regardless of resolution order', async () => {
    registerChartQuery('__test_multi_assembly__', () => ({
      queries: [
        { key: 'a', query: 'SELECT 1 AS a' },
        { key: 'b', query: 'SELECT 2 AS b' },
        { key: 'c', query: 'SELECT 3 AS c' },
      ],
    }))

    // 'a' resolves last, 'c' resolves first — proves the result is ordered
    // by the `queries` array (a Promise.all guarantee), not by completion
    // order, which is what keeps `executedSql` deterministic after
    // parallelizing.
    const delayTicks: Record<string, number> = {
      'SELECT 1 AS a': 3,
      'SELECT 2 AS b': 2,
      'SELECT 3 AS c': 1,
    }
    queryConnection = mock(
      async (
        _credentials: ConnectionCredentials,
        query: string,
        _options?: unknown
      ): Promise<QueryConnectionResult> => {
        for (let i = 0; i < (delayTicks[query] ?? 0); i++) {
          await Promise.resolve()
        }
        return { data: [{ query }], queryId: undefined, duration: 0 }
      }
    )

    const result = await executeConnectionChartQuery(
      '__test_multi_assembly__',
      credentials
    )

    expect(result.data).toEqual({
      a: [{ query: 'SELECT 1 AS a' }],
      b: [{ query: 'SELECT 2 AS b' }],
      c: [{ query: 'SELECT 3 AS c' }],
    })
    expect(result.metadata.rows).toBe(3)
    expect(result.executedSql).toBe(
      'a: SELECT 1 AS a\nb: SELECT 2 AS b\nc: SELECT 3 AS c\n'
    )
    expect(queryConnection).toHaveBeenCalledTimes(3)
  })

  test('starts all queries concurrently instead of awaiting them one at a time', async () => {
    registerChartQuery('__test_multi_concurrency__', () => ({
      queries: [
        { key: 'a', query: 'SELECT a' },
        { key: 'b', query: 'SELECT b' },
        { key: 'c', query: 'SELECT c' },
      ],
    }))

    let inFlight = 0
    let maxInFlight = 0
    queryConnection = mock(
      async (
        _credentials: ConnectionCredentials,
        _query: string,
        _options?: unknown
      ): Promise<QueryConnectionResult> => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        // A serial `for await` loop would never let `inFlight` exceed 1,
        // since it awaits each call before starting the next; Promise.all
        // starts every mapped call before any of them can resume.
        await Promise.resolve()
        await Promise.resolve()
        inFlight--
        return { data: [], queryId: undefined, duration: 0 }
      }
    )

    await executeConnectionChartQuery('__test_multi_concurrency__', credentials)

    expect(maxInFlight).toBe(3)
  })
})
