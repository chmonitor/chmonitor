import { mockFetchData } from './shared-mocks'
import { beforeEach, describe, expect, test } from 'bun:test'

const { createMvDesignerTools } = await import('../mv-designer-tools')

type Call = {
  query: string
  hostId?: number
  query_params?: Record<string, unknown>
  clickhouse_settings?: Record<string, unknown>
}

const SAMPLE =
  'SELECT status, count() AS c FROM analytics.events GROUP BY status ORDER BY c DESC'

/**
 * Routes the mocked fetchData by which system table the designer reads and
 * records every call, so host scoping and read-only behaviour can be checked.
 */
function route(opts: {
  shapes?: Array<Record<string, unknown>>
  partsRows?: number
  queryLogError?: boolean
}) {
  const calls: Call[] = []
  mockFetchData.mockImplementation(async (params: Call) => {
    calls.push(params)
    const q = params.query
    if (q.includes('system.query_log')) {
      if (opts.queryLogError) return { data: [], error: { message: 'denied' } }
      return { data: opts.shapes ?? [], error: null }
    }
    if (q.includes('system.parts')) {
      return {
        data: [
          { rows: opts.partsRows ?? 1_000_000, bytes_on_disk: 500_000_000 },
        ],
        error: null,
      }
    }
    if (q.includes('system.tables')) {
      return { data: [{ sorting_key: 'event_date, status' }], error: null }
    }
    return { data: [{ distinct_combos: 10 }], error: null }
  })
  return calls
}

const shape = (hash: string, sql = SAMPLE) => ({
  hash,
  calls: '100',
  total_read_bytes: '9000000000',
  sample_query: sql,
})

function tool(hostId = 0) {
  return (createMvDesignerTools(hostId) as any).recommend_materialized_view
}

function parse(input: unknown) {
  return tool().inputSchema.safeParse(input) as {
    success: boolean
    data?: { table?: string; windowHours?: number; hostId?: number }
  }
}

describe('recommend_materialized_view', () => {
  beforeEach(() => {
    mockFetchData.mockReset()
  })

  test('is exposed and described as recommend-only', () => {
    expect(tool()).toBeDefined()
    expect(tool().description).toContain('Recommend-only')
  })

  describe('inputSchema', () => {
    test('defaults windowHours to 168 (7 days)', () => {
      const r = parse({})
      expect(r.success).toBe(true)
      expect(r.data?.windowHours).toBe(168)
    })

    test('rejects non-positive and fractional windowHours', () => {
      expect(parse({ windowHours: 0 }).success).toBe(false)
      expect(parse({ windowHours: -5 }).success).toBe(false)
      expect(parse({ windowHours: 1.5 }).success).toBe(false)
    })

    test('rejects a negative hostId and treats blank hostId as unset', () => {
      expect(parse({ hostId: -1 }).success).toBe(false)
      const blank = parse({ hostId: '' })
      expect(blank.success).toBe(true)
      expect(blank.data?.hostId).toBeUndefined()
    })

    test('keeps the table filter', () => {
      expect(parse({ table: 'analytics.events' }).data?.table).toBe(
        'analytics.events'
      )
    })
  })

  describe('execute', () => {
    test('returns a recommendation with DDL text, shape and counts', async () => {
      route({ shapes: [shape('h1')] })
      const res = (await tool().execute({ windowHours: 24 })) as any

      expect(res.available).toBe(true)
      expect(res.windowHours).toBe(24)
      expect(res.shapesAnalyzed).toBe(1)
      expect(res.shapesWithRecommendation).toBe(1)
      expect(res.coverageRatio).toBe(1)
      const rec = res.recommendations[0]
      expect(rec.table).toContain('events')
      expect(rec.groupByKeys).toEqual(['status'])
      expect(rec.ddl).toMatch(/CREATE|ALTER/)
      expect(rec.risk.length).toBeGreaterThan(0)
      expect(rec.sampleQuery).toBe(SAMPLE)
    })

    test('uses the factory hostId for every query when no override is given', async () => {
      const calls = route({ shapes: [shape('h1')] })
      await tool(3).execute({})

      expect(calls.length).toBeGreaterThan(1)
      expect(calls.every((c) => c.hostId === 3)).toBe(true)
    })

    test('routes every query to the hostId override, not the factory host', async () => {
      const calls = route({ shapes: [shape('h1')] })
      await tool(3).execute({ hostId: 7 })

      expect(calls.length).toBeGreaterThan(1)
      expect(calls.every((c) => c.hostId === 7)).toBe(true)
    })

    test('a hostId override of 0 is honoured (not treated as falsy)', async () => {
      const calls = route({ shapes: [shape('h1')] })
      await tool(3).execute({ hostId: 0 })

      expect(calls.length).toBeGreaterThan(1)
      expect(calls.every((c) => c.hostId === 0)).toBe(true)
    })

    test('passes windowHours to the query_log mining query', async () => {
      const calls = route({})
      await tool().execute({ windowHours: 48 })

      const mining = calls.find((c) => c.query.includes('system.query_log'))
      expect(mining).toBeDefined()
      expect(mining?.query_params?.windowHours).toBe(48)
    })

    test('table filter narrows shapes (qualified, case-insensitive, and bare name)', async () => {
      const other =
        'SELECT k, sum(v) FROM analytics.other GROUP BY k ORDER BY k'
      route({ shapes: [shape('h1'), shape('h2', other)] })

      const qualified = (await tool().execute({
        table: 'Analytics.Events',
      })) as any
      expect(qualified.shapesAnalyzed).toBe(1)
      expect(qualified.recommendations[0].table).toContain('events')

      const bare = (await tool().execute({ table: 'other' })) as any
      expect(bare.shapesAnalyzed).toBe(1)
      expect(bare.recommendations[0].table).toContain('other')
    })

    test('a table with no matching shape yields zero coverage, not an error', async () => {
      route({ shapes: [shape('h1')] })
      const res = (await tool().execute({ table: 'nope' })) as any

      expect(res.available).toBe(true)
      expect(res.shapesAnalyzed).toBe(0)
      expect(res.coverageRatio).toBe(0)
      expect(res.recommendations).toEqual([])
    })

    test('skips shapes whose source table is empty', async () => {
      route({ shapes: [shape('h1')], partsRows: 0 })
      const res = (await tool().execute({})) as any

      expect(res.shapesAnalyzed).toBe(1)
      expect(res.shapesWithRecommendation).toBe(0)
      expect(res.recommendations).toEqual([])
    })

    test('reports unavailable instead of fabricating when query_log fails', async () => {
      route({ queryLogError: true })
      const res = (await tool().execute({})) as any

      expect(res.available).toBe(false)
      expect(res.reason).toBe('query_log_unavailable')
      expect(res.recommendations).toBeUndefined()
    })

    test('read-only: only readonly SELECTs are sent, DDL is returned as text', async () => {
      const calls = route({ shapes: [shape('h1')] })
      const res = (await tool().execute({})) as any

      expect(res.recommendations[0].ddl).toMatch(/CREATE|ALTER/)
      expect(calls.length).toBeGreaterThan(1)
      for (const c of calls) {
        expect(c.query.trimStart()).toMatch(/^SELECT/i)
        expect(c.query).not.toMatch(/\b(CREATE|ALTER|INSERT|DROP)\b/i)
        expect(c.clickhouse_settings?.readonly).toBe('1')
      }
    })
  })
})
