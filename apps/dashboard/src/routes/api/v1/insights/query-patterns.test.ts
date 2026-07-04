/**
 * Tests for GET /api/v1/insights/query-patterns.
 *
 * hostId boundary validation follows the same contract as every other
 * `/api/v1/*` route (docs/knowledge/api-hostid-validation.md): a non-negative
 * integer or 400, checked BEFORE any query executes.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

const getTableQuery = mock(
  (
    _name: string,
    params: { hostId: number | string; searchParams?: Record<string, string> }
  ) => ({
    query: 'SELECT 1',
    queryParams: undefined,
    queryConfig: { name: 'slow-query-patterns', sql: 'SELECT 1', columns: [] },
    // Surface what was passed through so tests can assert on it.
    __searchParams: params.searchParams,
  })
)

mock.module('@/lib/api/table-registry', () => ({ getTableQuery }))

const executeTableConfig = mock(async () => ({
  result: {
    data: [
      { normalized_query_hash: '111', total_duration: 5, calls: 2 },
      { normalized_query_hash: '222', total_duration: 50, calls: 1 },
    ],
    metadata: { queryId: 'q1', duration: 12, rows: 2 },
  },
  executedSql: 'SELECT 1',
  clickhouseVersion: '24.8',
}))

mock.module('@/lib/api/query-executor', () => ({ executeTableConfig }))

const { handler } = await import('@/routes/api/v1/insights/query-patterns')

function request(query: string): Request {
  return new Request(`http://x/api/v1/insights/query-patterns${query}`)
}

interface PatternsResponseBody {
  success: boolean
  data: Array<{
    normalized_query_hash: string
    calls: number
    total_duration: number
  }>
  metadata: { host: string; rows: number }
}

describe('GET /api/v1/insights/query-patterns — hostId validation', () => {
  beforeEach(() => {
    executeTableConfig.mockClear()
    getTableQuery.mockClear()
  })

  test('rejects negative hostId with 400', async () => {
    const res = await handler(request('?hostId=-1'))
    expect(res.status).toBe(400)
    expect(executeTableConfig).not.toHaveBeenCalled()
  })

  test('rejects fractional hostId with 400', async () => {
    expect((await handler(request('?hostId=1.5'))).status).toBe(400)
  })

  test('rejects non-numeric hostId with 400', async () => {
    expect((await handler(request('?hostId=abc'))).status).toBe(400)
  })

  test('accepts the `host` shorthand param when hostId is absent', async () => {
    const res = await handler(request('?host=3'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as PatternsResponseBody
    expect(body.metadata.host).toBe('3')
  })

  test('defaults to host 0 when hostId is absent', async () => {
    const res = await handler(request(''))
    expect(res.status).toBe(200)
    expect(executeTableConfig).toHaveBeenCalled()
  })

  test('accepts a valid hostId and returns the aggregated rows', async () => {
    const res = await handler(request('?hostId=2'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as PatternsResponseBody
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
    expect(body.metadata.host).toBe('2')
  })
})

describe('GET /api/v1/insights/query-patterns — filter/sort ergonomics', () => {
  beforeEach(() => {
    executeTableConfig.mockClear()
    getTableQuery.mockClear()
  })

  test('translates range=N into event_time=withinHours:N', async () => {
    await handler(request('?range=6'))
    const call = getTableQuery.mock.calls[0]
    expect(call?.[1].searchParams).toEqual({ event_time: 'withinHours:6' })
  })

  test('an explicit event_time filter wins over range', async () => {
    await handler(request('?range=6&event_time=withinHours:1'))
    const call = getTableQuery.mock.calls[0]
    expect(call?.[1].searchParams?.event_time).toBe('withinHours:1')
  })

  test('forwards other filter fields untouched', async () => {
    await handler(request('?user=eq:default&query_kind=in:Select'))
    const call = getTableQuery.mock.calls[0]
    expect(call?.[1].searchParams).toEqual({
      user: 'eq:default',
      query_kind: 'in:Select',
    })
  })

  test('sort=calls:asc re-orders the rows ascending by calls', async () => {
    const res = await handler(request('?sort=calls:asc'))
    const body = (await res.json()) as PatternsResponseBody
    expect(body.data.map((r) => r.calls)).toEqual([1, 2])
  })

  test('sort=total_duration:desc (default direction) keeps larger first', async () => {
    const res = await handler(request('?sort=total_duration'))
    const body = (await res.json()) as PatternsResponseBody
    expect(body.data[0]?.total_duration).toBe(50)
  })
})
