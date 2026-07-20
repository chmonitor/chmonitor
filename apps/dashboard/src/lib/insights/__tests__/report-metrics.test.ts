/**
 * Collector tests for the report's data-rich sections.
 *
 * `readOnlyQuery` (the only I/O boundary) is stubbed per-test, so these verify
 * the mapping/coercion logic (ClickHouse UInt64 arrives as strings over JSON)
 * and the fail-open contract: any query failure yields `undefined`, never a
 * throw. mock.module precedes the dynamic import of the module under test
 * (same pattern as weekly-report.test.ts).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

type QueryStub = (options: {
  query: string
  hostId: number
  query_params?: Record<string, unknown>
}) => Promise<unknown>

let queryStub: QueryStub = async () => []

mock.module('@/lib/ai/agent/tools/helpers', () => ({
  readOnlyQuery: (options: Parameters<QueryStub>[0]) => queryStub(options),
}))

const { collectIngestion, collectQueryActivity, collectStorage } = await import(
  '../report-metrics'
)

beforeEach(() => {
  queryStub = async () => []
})

describe('collectQueryActivity', () => {
  test('maps totals + daily series and coerces string numbers', async () => {
    queryStub = async ({ query }) => {
      if (query.includes('toDate(event_time)')) {
        return [
          { date: '2026-07-14', queries: '100', failed: '2' },
          { date: '2026-07-15', queries: 200, failed: 0 },
        ]
      }
      return [{ queries: '300', failed: '2', p50_ms: 15, p95_ms: '480' }]
    }
    const result = await collectQueryActivity(0, 7)
    expect(result).toEqual({
      totalQueries: 300,
      failedQueries: 2,
      p50Ms: 15,
      p95Ms: 480,
      dailyQueries: [
        { date: '2026-07-14', value: 100 },
        { date: '2026-07-15', value: 200 },
      ],
      dailyFailed: [
        { date: '2026-07-14', value: 2 },
        { date: '2026-07-15', value: 0 },
      ],
    })
  })

  test('passes the window size as a query param', async () => {
    const seen: Array<Record<string, unknown> | undefined> = []
    queryStub = async ({ query, query_params }) => {
      seen.push(query_params)
      return query.includes('toDate') ? [] : [{ queries: 0, failed: 0 }]
    }
    await collectQueryActivity(0, 30)
    expect(seen.every((p) => p?.days === 30)).toBe(true)
  })

  test('returns undefined on query failure (fail-open)', async () => {
    queryStub = async () => {
      throw new Error('query_log unavailable')
    }
    expect(await collectQueryActivity(0, 7)).toBeUndefined()
  })
})

describe('collectIngestion', () => {
  test('sums totals from the daily series', async () => {
    queryStub = async () => [
      { date: '2026-07-14', rows: '1000', bytes: '2000000' },
      { date: '2026-07-15', rows: 3000, bytes: 4000000 },
    ]
    const result = await collectIngestion(0, 7)
    expect(result?.totalRows).toBe(4000)
    expect(result?.totalBytes).toBe(6000000)
    expect(result?.dailyBytes).toHaveLength(2)
    expect(result?.dailyRows[0]).toEqual({ date: '2026-07-14', value: 1000 })
  })

  test('returns undefined on failure', async () => {
    queryStub = async () => {
      throw new Error('boom')
    }
    expect(await collectIngestion(0, 7)).toBeUndefined()
  })
})

describe('collectStorage', () => {
  test('maps totals and top tables', async () => {
    queryStub = async ({ query }) => {
      if (query.includes('concat(database')) {
        return [
          {
            table: 'default.events',
            bytes: '500',
            rows: '900',
            new_bytes: '20',
          },
        ]
      }
      return [{ bytes: '800', rows: '1200' }]
    }
    const result = await collectStorage(0, 7)
    expect(result).toEqual({
      totalBytes: 800,
      totalRows: 1200,
      topTables: [
        { table: 'default.events', bytes: 500, rows: 900, newBytes: 20 },
      ],
    })
  })

  test('returns undefined on failure', async () => {
    queryStub = async () => {
      throw new Error('parts unavailable')
    }
    expect(await collectStorage(0, 7)).toBeUndefined()
  })
})
