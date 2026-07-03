import { mockFetchData } from './shared-mocks'
import { describe, expect, type mock, test } from 'bun:test'

const queryResults: Record<string, unknown[]> = {
  running: [
    {
      query_id: 'abc-123',
      user: 'analyst',
      elapsed: 12.5,
      read_rows: 5000000,
      memory_usage: 104857600,
      query: 'SELECT * FROM analytics.events WHERE event_date = today()',
    },
  ],
  slow: [
    {
      query_id: 'slow-1',
      user: 'admin',
      query_duration_ms: 30000,
      read_rows: 100000000,
      memory_usage: 536870912,
      query: 'SELECT count() FROM analytics.events GROUP BY status',
      event_time: '2026-05-30 10:00:00',
    },
  ],
  failed: [
    {
      query_id: 'fail-1',
      user: 'dev',
      exception_code: 47,
      error: 'Missing column: nonexistent_col',
      query_duration_ms: 50,
      event_time: '2026-05-30 09:30:00',
      query: 'SELECT nonexistent_col FROM analytics.events',
    },
  ],
  explain: [
    { explain: 'ExpressionProjection: Transformated output' },
    { explain: '  MergeTree InOrder' },
  ],
}

function setupQueryMock() {
  mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
    const q = query

    if (q.includes('system.processes'))
      return { data: queryResults.running, error: null }
    if (
      q.includes('QueryFinish') &&
      q.includes('query_duration_ms') &&
      !q.includes('read_bytes')
    )
      return { data: queryResults.slow, error: null }
    if (q.includes('ExceptionWhileProcessing'))
      return { data: queryResults.failed, error: null }
    if (q.includes('EXPLAIN'))
      return { data: queryResults.explain, error: null }

    return { data: [], error: null }
  })
}

const { createQueryTools } = await import('../query-tools')

describe('createQueryTools', () => {
  test('creates all query tools', () => {
    const tools = createQueryTools(0) as any
    expect(tools.get_running_queries).toBeDefined()
    expect(tools.get_slow_queries).toBeDefined()
    expect(tools.get_failed_queries).toBeDefined()
    expect(tools.explain_query).toBeDefined()
    expect(tools.estimate_query_cost).toBeDefined()
  })

  describe('get_running_queries', () => {
    test('returns currently running queries', async () => {
      setupQueryMock()

      const tools = createQueryTools(0) as any
      const result = await tools.get_running_queries.execute({})

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(1)
      expect(result[0].query_id).toBe('abc-123')
      expect(result[0].user).toBe('analyst')
    })
  })

  describe('get_slow_queries', () => {
    test('returns slow queries with default limit', async () => {
      setupQueryMock()

      const tools = createQueryTools(0) as any
      const result = await tools.get_slow_queries.execute({})

      expect(Array.isArray(result)).toBe(true)
      expect(result[0].query_duration_ms).toBe(30000)
    })

    test('passes custom limit', async () => {
      setupQueryMock()

      const tools = createQueryTools(0) as any
      const result = await tools.get_slow_queries.execute({ limit: 5 })

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('get_failed_queries', () => {
    test('returns failed queries with default params', async () => {
      setupQueryMock()

      const tools = createQueryTools(0) as any
      const result = await tools.get_failed_queries.execute({})

      expect(Array.isArray(result)).toBe(true)
      expect(result[0].error).toContain('Missing column')
      expect(result[0].exception_code).toBe(47)
    })

    test('accepts custom limit and lastHours', async () => {
      setupQueryMock()

      const tools = createQueryTools(0) as any
      const result = await tools.get_failed_queries.execute({
        limit: 5,
        lastHours: 48,
      })

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('explain_query', () => {
    test('returns execution plan with default type', async () => {
      setupQueryMock()

      const tools = createQueryTools(0) as any
      const result = await tools.explain_query.execute({
        sql: 'SELECT count() FROM system.tables',
      })

      expect(Array.isArray(result)).toBe(true)
      expect(result[0].explain).toBeDefined()
    })

    test('generates EXPLAIN PLAN for default/plan type', async () => {
      let capturedQuery = ''
      mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
        capturedQuery = query
        return { data: queryResults.explain, error: null }
      })

      const tools = createQueryTools(0) as any
      await tools.explain_query.execute({
        sql: 'SELECT count() FROM system.tables',
        type: 'plan',
      })

      expect(capturedQuery).toBe(
        'EXPLAIN PLAN SELECT count() FROM system.tables'
      )
    })

    test('generates EXPLAIN PIPELINE for pipeline type', async () => {
      let capturedQuery = ''
      mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
        capturedQuery = query
        return { data: queryResults.explain, error: null }
      })

      const tools = createQueryTools(0) as any
      const result = await tools.explain_query.execute({
        sql: 'SELECT count() FROM system.tables',
        type: 'pipeline',
      })

      expect(Array.isArray(result)).toBe(true)
      expect(capturedQuery).toBe(
        'EXPLAIN PIPELINE SELECT count() FROM system.tables'
      )
    })

    test('generates EXPLAIN PLAN indexes=1 for indexes type (not EXPLAIN INDEXES)', async () => {
      let capturedQuery = ''
      mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
        capturedQuery = query
        return { data: queryResults.explain, error: null }
      })

      const tools = createQueryTools(0) as any
      const result = await tools.explain_query.execute({
        sql: 'SELECT count() FROM system.tables',
        type: 'indexes',
      })

      expect(Array.isArray(result)).toBe(true)
      // Must use PLAN setting, not the invalid top-level EXPLAIN INDEXES mode
      expect(capturedQuery).toBe(
        'EXPLAIN PLAN indexes=1 SELECT count() FROM system.tables'
      )
      expect(capturedQuery).not.toContain('EXPLAIN INDEXES')
    })

    test('propagates validation errors', async () => {
      setupQueryMock()

      const tools = createQueryTools(0) as any
      const { validateSqlQuery } = await import('@chm/sql-builder')

      ;(validateSqlQuery as ReturnType<typeof mock>).mockImplementationOnce(
        () => {
          throw new Error('SQL validation failed: dangerous query')
        }
      )

      expect(
        tools.explain_query.execute({ sql: 'DROP TABLE system.tables' })
      ).rejects.toThrow('SQL validation failed')
    })
  })

  describe('estimate_query_cost', () => {
    test('returns a rows/bytes/memory/time cost estimate from EXPLAIN only', async () => {
      mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
        if (query.includes('EXPLAIN')) {
          const fixture = [
            {
              Plan: {
                'Node Type': 'ReadFromMergeTree',
                Description: 'default.events',
                Indexes: [
                  {
                    Type: 'PrimaryKey',
                    'Initial Parts': 1,
                    'Selected Parts': 1,
                    'Initial Granules': 10,
                    'Selected Granules': 10,
                  },
                ],
              },
            },
          ]
          const lines = JSON.stringify(fixture, null, 2).split('\n')
          return { data: lines.map((l) => ({ explain: l })), error: null }
        }
        return { data: [], error: null }
      })

      const tools = createQueryTools(0) as any
      const result = await tools.estimate_query_cost.execute({
        sql: 'SELECT * FROM default.events',
      })

      expect(result).toEqual(
        expect.objectContaining({
          estRows: expect.any(Number),
          estBytesRead: expect.any(Number),
          estPeakMemoryBytes: expect.any(Number),
          estWallMs: expect.any(Number),
          confidence: expect.any(String),
          warnings: expect.any(Array),
        })
      )
    })

    test('never calls fetchData when SQL validation rejects a mutating statement (never executes/mutates)', async () => {
      setupQueryMock()
      const tools = createQueryTools(0) as any
      const { validateSqlQuery } = await import('@chm/sql-builder')

      ;(validateSqlQuery as ReturnType<typeof mock>).mockImplementationOnce(
        () => {
          throw new Error('SQL validation failed: dangerous query')
        }
      )

      mockFetchData.mockClear()
      await expect(
        tools.estimate_query_cost.execute({
          sql: 'DROP TABLE default.events',
        })
      ).rejects.toThrow('SQL validation failed')
      expect(mockFetchData).not.toHaveBeenCalled()
    })
  })
})
