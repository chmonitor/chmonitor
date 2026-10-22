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

    test('returns 2000 chars of query text', async () => {
      let capturedQuery = ''
      mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
        capturedQuery = query
        return { data: queryResults.running, error: null }
      })

      const tools = createQueryTools(0) as any
      await tools.get_running_queries.execute({})

      expect(capturedQuery).toContain('substring(query, 1, 2000)')
      expect(capturedQuery).not.toContain('substring(query, 1, 200)')
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

    test('injects a 1-hour event_time predicate when called with no args', async () => {
      let capturedQuery = ''
      let capturedParams: Record<string, string> | undefined
      mockFetchData.mockImplementation(
        async ({
          query,
          query_params,
        }: {
          query: string
          query_params?: Record<string, string>
        }) => {
          capturedQuery = query
          capturedParams = query_params
          return { data: queryResults.slow, error: null }
        }
      )

      const tools = createQueryTools(0) as any
      await tools.get_slow_queries.execute({})

      expect(capturedQuery).toContain(
        'event_time > now() - INTERVAL {lastHours:UInt32} HOUR'
      )
      expect(capturedQuery).toContain("type = 'QueryFinish'")
      expect(capturedQuery).toContain('is_initial_query = 1')
      expect(capturedQuery).toContain('substring(query, 1, 2000)')
      expect(capturedQuery).not.toContain('substring(query, 1, 200)')
      expect(capturedParams?.lastHours).toBe('1')
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

    test('injects lastHours into the SQL when called with no args', async () => {
      let capturedQuery = ''
      let capturedParams: Record<string, string> | undefined
      mockFetchData.mockImplementation(
        async ({
          query,
          query_params,
        }: {
          query: string
          query_params?: Record<string, string>
        }) => {
          capturedQuery = query
          capturedParams = query_params
          return { data: queryResults.failed, error: null }
        }
      )

      const tools = createQueryTools(0) as any
      await tools.get_failed_queries.execute({})

      expect(capturedQuery).toContain(
        'event_time > now() - INTERVAL {lastHours:UInt32} HOUR'
      )
      expect(capturedParams?.lastHours).toBe('24')
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

// ---------------------------------------------------------------------------
// list_slow_query_patterns
//
// The tool delegates to the table registry + executor. Those modules pull in
// UI helpers that shared-mocks stubs out, so they are mocked here: the tests
// assert what the tool hands them (filters, host, row cap) and what it returns.
// ---------------------------------------------------------------------------
import type { AgentConnectionBinding } from '../../host-query'

import { mock as bunMock } from 'bun:test'

const fakeConfig = { name: 'slow-query-patterns', sql: 'SELECT 1' }

const mockGetTableQuery = bunMock(
  (_name: string, _params: { hostId: number; searchParams?: unknown }) =>
    ({ queryConfig: fakeConfig, queryParams: { p: 1 } }) as unknown
) as any
const mockExecuteTableConfig = bunMock(
  async (_cfg: unknown, _host: number, _params: unknown) => ({
    result: {
      data: [] as unknown[] | null,
      error: null as null | { message: string },
    },
  })
) as any
const mockExecuteConnection = bunMock(
  async (_cfg: unknown, _creds: unknown, _params: unknown) => ({
    data: [] as unknown[],
  })
) as any

bunMock.module('@/lib/api/table-registry', () => ({
  getTableQuery: mockGetTableQuery,
}))
bunMock.module('@/lib/api/query-executor', () => ({
  executeTableConfig: mockExecuteTableConfig,
}))
bunMock.module('@/lib/connection-query/execute-connection-table', () => ({
  executeConnectionTableConfig: mockExecuteConnection,
}))

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }))

type Schema = { safeParse: (v: unknown) => { success: boolean; data?: any } }

describe('list_slow_query_patterns', () => {
  const run = (hostId: number, input: Record<string, unknown>) =>
    (createQueryTools(hostId) as any).list_slow_query_patterns.execute(input)

  const schema = () =>
    (createQueryTools(0) as any).list_slow_query_patterns.inputSchema as Schema

  const resetMocks = () => {
    mockFetchData.mockClear()
    mockGetTableQuery.mockClear()
    mockGetTableQuery.mockImplementation(
      () => ({ queryConfig: fakeConfig, queryParams: { p: 1 } }) as unknown
    )
    mockExecuteTableConfig.mockClear()
    mockExecuteTableConfig.mockImplementation(async () => ({
      result: { data: rows(5), error: null },
    }))
    mockExecuteConnection.mockClear()
    mockExecuteConnection.mockImplementation(async () => ({ data: rows(5) }))
  }

  describe('input validation', () => {
    test('applies defaults: limit 10, lastHours 24', () => {
      const parsed = schema().safeParse({})
      expect(parsed.success).toBe(true)
      expect(parsed.data.limit).toBe(10)
      expect(parsed.data.lastHours).toBe(24)
    })

    test.each([
      [{ limit: 0 }],
      [{ limit: 101 }],
      [{ limit: 1.5 }],
      [{ lastHours: 0 }],
      [{ lastHours: 721 }],
      [{ hostId: -1 }],
      [{ user: 42 }],
    ])('rejects out-of-range input %j', (input) => {
      expect(schema().safeParse(input).success).toBe(false)
    })

    test('accepts the boundary values', () => {
      expect(
        schema().safeParse({ limit: 100, lastHours: 720, hostId: 0 }).success
      ).toBe(true)
      expect(schema().safeParse({ limit: 1, lastHours: 1 }).success).toBe(true)
    })
  })

  describe('filters (never interpolated into SQL)', () => {
    test('with no filters only the time window is requested', async () => {
      resetMocks()
      await run(0, {})
      expect(mockGetTableQuery).toHaveBeenCalledWith('slow-query-patterns', {
        hostId: 0,
        searchParams: { event_time: 'withinHours:24' },
      })
    })

    test('passes lastHours, user, queryKind and database as eq: filters', async () => {
      resetMocks()
      await run(0, {
        lastHours: 6,
        user: 'analyst',
        queryKind: 'Select',
        database: 'analytics',
      })
      expect(mockGetTableQuery.mock.calls[0][1].searchParams).toEqual({
        event_time: 'withinHours:6',
        user: 'eq:analyst',
        query_kind: 'eq:Select',
        database: 'eq:analytics',
      })
    })

    test('a hostile user value stays a filter value; the tool builds no SQL', async () => {
      resetMocks()
      const evil = "x' OR 1=1; DROP TABLE system.query_log --"
      await run(0, { user: evil })
      expect(mockGetTableQuery.mock.calls[0][1].searchParams.user).toBe(
        `eq:${evil}`
      )
      // The config handed to the executor is the registry's, untouched.
      expect(mockExecuteTableConfig.mock.calls[0][0]).toBe(fakeConfig)
      expect(mockFetchData).not.toHaveBeenCalled()
    })

    test('empty-string filters are ignored', async () => {
      resetMocks()
      await run(0, { user: '', queryKind: '', database: '' })
      expect(mockGetTableQuery.mock.calls[0][1].searchParams).toEqual({
        event_time: 'withinHours:24',
      })
    })
  })

  describe('host scoping', () => {
    test('uses the factory hostId when the input has none', async () => {
      resetMocks()
      await run(3, {})
      expect(mockGetTableQuery.mock.calls[0][1].hostId).toBe(3)
      expect(mockExecuteTableConfig.mock.calls[0][1]).toBe(3)
    })

    test('an input hostId overrides the factory hostId', async () => {
      resetMocks()
      await run(3, { hostId: 7 })
      expect(mockGetTableQuery.mock.calls[0][1].hostId).toBe(7)
      expect(mockExecuteTableConfig.mock.calls[0][1]).toBe(7)
    })

    test('hostId 0 as an explicit override is honoured (not treated as unset)', async () => {
      resetMocks()
      await run(3, { hostId: 0 })
      expect(mockExecuteTableConfig.mock.calls[0][1]).toBe(0)
    })
  })

  describe('results', () => {
    test('caps the returned rows at limit', async () => {
      resetMocks()
      const out = await run(0, { limit: 2 })
      expect(out).toEqual(rows(2))
    })

    test('defaults the cap to 10 rows', async () => {
      resetMocks()
      mockExecuteTableConfig.mockImplementation(async () => ({
        result: { data: rows(25), error: null },
      }))
      expect(await run(0, {})).toHaveLength(10)
    })

    test('returns an empty array when the result has no data', async () => {
      resetMocks()
      mockExecuteTableConfig.mockImplementation(async () => ({
        result: { data: null, error: null },
      }))
      expect(await run(0, {})).toEqual([])
    })
  })

  describe('error paths', () => {
    test('throws when the query config is not registered', async () => {
      resetMocks()
      mockGetTableQuery.mockImplementation(() => null)
      await expect(run(0, {})).rejects.toThrow(
        'slow-query-patterns query config not found'
      )
      expect(mockExecuteTableConfig).not.toHaveBeenCalled()
    })

    test('surfaces the ClickHouse error message instead of returning rows', async () => {
      resetMocks()
      mockExecuteTableConfig.mockImplementation(async () => ({
        result: { data: null, error: { message: 'query_log is disabled' } },
      }))
      await expect(run(0, {})).rejects.toThrow('query_log is disabled')
    })

    test('propagates executor rejections', async () => {
      resetMocks()
      mockExecuteTableConfig.mockImplementation(async () => {
        throw new Error('connection refused')
      })
      await expect(run(0, {})).rejects.toThrow('connection refused')
    })
  })

  describe('bound user connection', () => {
    const binding: AgentConnectionBinding = {
      hostId: -1001,
      userId: 'u1',
      connectionId: 'c1',
      credentials: { url: 'https://ch.example' } as any,
    }

    test('runs on the bound connection, never the env host, and caps rows', async () => {
      resetMocks()
      const { runWithAgentConnection } = await import('../../host-query')
      const out = await runWithAgentConnection(binding, () =>
        run(-1001, { limit: 3 })
      )
      expect(out).toEqual(rows(3))
      expect(mockExecuteConnection).toHaveBeenCalledTimes(1)
      expect(mockExecuteConnection.mock.calls[0][0]).toBe(fakeConfig)
      expect(mockExecuteConnection.mock.calls[0][1]).toBe(binding.credentials)
      expect(mockExecuteConnection.mock.calls[0][2]).toEqual({ p: 1 })
      expect(mockExecuteTableConfig).not.toHaveBeenCalled()
    })

    test('refuses a hostId override that is not the bound connection', async () => {
      resetMocks()
      const { runWithAgentConnection } = await import('../../host-query')
      await expect(
        runWithAgentConnection(binding, () => run(-1001, { hostId: 0 }))
      ).rejects.toThrow('not available here')
      expect(mockExecuteConnection).not.toHaveBeenCalled()
      expect(mockExecuteTableConfig).not.toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// estimate_query_cost: input validation and host scoping
// ---------------------------------------------------------------------------
describe('estimate_query_cost host scoping', () => {
  test('rejects a missing sql input', () => {
    const schema = (createQueryTools(0) as any).estimate_query_cost
      .inputSchema as Schema
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ sql: 'SELECT 1' }).success).toBe(true)
  })

  test('sends the EXPLAIN to the factory host, or the input override', async () => {
    const hosts: Array<number | undefined> = []
    mockFetchData.mockImplementation(async (p: { hostId?: number }) => {
      hosts.push(p.hostId)
      return { data: [], error: null }
    })
    const tools = createQueryTools(4) as any
    await tools.estimate_query_cost
      .execute({ sql: 'SELECT 1' })
      .catch(() => undefined)
    const afterDefault = hosts.length
    await tools.estimate_query_cost
      .execute({ sql: 'SELECT 1', hostId: 9 })
      .catch(() => undefined)
    expect(afterDefault).toBeGreaterThan(0)
    expect(hosts.slice(0, afterDefault).every((h) => h === 4)).toBe(true)
    expect(hosts.length).toBeGreaterThan(afterDefault)
    expect(hosts.slice(afterDefault).every((h) => h === 9)).toBe(true)
  })
})
