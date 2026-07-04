/**
 * Tests for GET /api/v1/insights/query-patterns/$hash.
 *
 * hostId boundary validation follows the same contract as every other
 * `/api/v1/*` route (docs/knowledge/api-hostid-validation.md), plus the
 * `normalized_query_hash` path param must be a numeric string.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

const patternRow = {
  normalized_query_hash: '123456789',
  normalized_query: 'SELECT * FROM t',
  calls: 3,
  total_duration: 9,
}
const executionRows = [
  { event_time: '2026-07-04 00:00:00', query_id: 'a' },
  { event_time: '2026-07-03 23:59:00', query_id: 'b' },
]

let patternData: Record<string, unknown>[] = [patternRow]

const executeTableConfig = mock(
  async (
    config: { name: string },
    _hostId: number | string,
    _queryParams: Record<string, unknown> | undefined,
    _options: Record<string, unknown>
  ) => {
    if (config.name === 'insights-query-pattern-detail') {
      return {
        result: {
          data: patternData,
          metadata: { queryId: 'p1', duration: 5, rows: patternData.length },
        },
        executedSql: 'SELECT /* pattern */ 1',
        clickhouseVersion: '24.8',
      }
    }
    return {
      result: {
        data: executionRows,
        metadata: { queryId: 'e1', duration: 7, rows: executionRows.length },
      },
      executedSql: 'SELECT /* executions */ 1',
      clickhouseVersion: '24.8',
    }
  }
)

mock.module('@/lib/api/query-executor', () => ({ executeTableConfig }))

const { handler } = await import(
  '@/routes/api/v1/insights/query-patterns/$hash'
)

async function call(hash: string, query = ''): Promise<Response> {
  return handler(
    new Request(`http://x/api/v1/insights/query-patterns/${hash}${query}`),
    hash
  )
}

interface DetailErrorBody {
  success: false
  error: { type: string; message: string }
}
interface DetailSuccessBody {
  success: true
  data: {
    pattern: Record<string, unknown>
    executions: Record<string, unknown>[]
  }
  metadata: { host: string; rangeHours: number }
}

describe('GET /api/v1/insights/query-patterns/$hash — validation', () => {
  beforeEach(() => {
    executeTableConfig.mockClear()
    patternData = [patternRow]
  })

  test('rejects negative hostId with 400', async () => {
    const res = await call('123', '?hostId=-1')
    expect(res.status).toBe(400)
    expect(executeTableConfig).not.toHaveBeenCalled()
  })

  test('rejects fractional hostId with 400', async () => {
    expect((await call('123', '?hostId=1.5')).status).toBe(400)
  })

  test('rejects non-numeric hostId with 400', async () => {
    expect((await call('123', '?hostId=abc')).status).toBe(400)
  })

  test('rejects a non-numeric normalized_query_hash with 400', async () => {
    const res = await call('not-a-hash')
    expect(res.status).toBe(400)
    expect(executeTableConfig).not.toHaveBeenCalled()
  })

  test('returns 404 when no pattern matches the hash', async () => {
    patternData = []
    const res = await call('999')
    expect(res.status).toBe(404)
    const body = (await res.json()) as DetailErrorBody
    expect(body.success).toBe(false)
    expect(body.error.type).toBe('not_found')
  })
})

describe('GET /api/v1/insights/query-patterns/$hash — shape', () => {
  beforeEach(() => {
    executeTableConfig.mockClear()
    patternData = [patternRow]
  })

  test('returns the pattern + its recent executions', async () => {
    const res = await call('123456789')
    expect(res.status).toBe(200)
    const body = (await res.json()) as DetailSuccessBody
    expect(body.success).toBe(true)
    expect(body.data.pattern).toEqual(patternRow)
    expect(body.data.executions).toEqual(executionRows)
    expect(body.metadata.host).toBe('0')
    expect(body.metadata.rangeHours).toBe(24)
  })

  test('passes the same normalized_query_hash + range to both queries', async () => {
    await call('123456789', '?range=6')
    expect(executeTableConfig).toHaveBeenCalledTimes(2)
    for (const c of executeTableConfig.mock.calls) {
      expect(c[2]).toMatchObject({
        normalized_query_hash: '123456789',
        range_hours: 6,
      })
    }
  })
})
