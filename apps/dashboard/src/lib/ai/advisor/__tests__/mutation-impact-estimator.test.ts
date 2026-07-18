// @ts-nocheck — test file, only runs under bun:test
import { describe, expect, mock, test } from 'bun:test'

// bun test runs with --isolate (see apps/dashboard/package.json), so
// mock.module() here is scoped to this file's process.
const mockFetchData = mock(
  async (_params: {
    query: string
    hostId?: number
    query_params?: Record<string, unknown>
  }) => ({
    data: [] as any[],
    error: null,
  })
) as any
mock.module('@chm/clickhouse-client', () => ({ fetchData: mockFetchData }))

const mockCheckTableExists = mock(async () => true) as any
mock.module('@chm/clickhouse-client/table-existence-cache', () => ({
  checkTableExists: mockCheckTableExists,
}))

const {
  parseMutationSql,
  estimateMutationImpact,
  quoteIdentifier,
  DISK_SAFETY_FACTOR,
} = await import('../mutation-impact-estimator')

describe('parseMutationSql', () => {
  test('parses ALTER TABLE ... DELETE WHERE ...', () => {
    const result = parseMutationSql(
      'ALTER TABLE analytics.events DELETE WHERE event_date < today() - 30'
    )
    expect(result).toEqual({
      kind: 'DELETE',
      database: 'analytics',
      table: 'events',
      whereClause: 'event_date < today() - 30',
    })
  })

  test('parses ALTER TABLE ... UPDATE ... WHERE ...', () => {
    const result = parseMutationSql(
      "ALTER TABLE analytics.events UPDATE status = 'archived' WHERE user_id = 42"
    )
    expect(result.kind).toBe('UPDATE')
    expect(result.database).toBe('analytics')
    expect(result.table).toBe('events')
    expect(result.whereClause).toBe('user_id = 42')
  })

  test('defaults to the default database when unqualified', () => {
    const result = parseMutationSql('ALTER TABLE events DELETE WHERE id = 1')
    expect(result.database).toBe('default')
    expect(result.table).toBe('events')
  })

  test('supports ON CLUSTER', () => {
    const result = parseMutationSql(
      'ALTER TABLE analytics.events ON CLUSTER my_cluster DELETE WHERE id = 1'
    )
    expect(result.database).toBe('analytics')
    expect(result.table).toBe('events')
    expect(result.whereClause).toBe('id = 1')
  })

  test('strips a trailing semicolon', () => {
    const result = parseMutationSql(
      'ALTER TABLE analytics.events DELETE WHERE id = 1;'
    )
    expect(result.whereClause).toBe('id = 1')
  })

  test('rejects chained statements', () => {
    expect(() =>
      parseMutationSql(
        'ALTER TABLE events DELETE WHERE id = 1; DROP TABLE events'
      )
    ).toThrow(/single/i)
  })

  test('rejects a non-mutation ALTER statement', () => {
    expect(() =>
      parseMutationSql(
        'ALTER TABLE events MODIFY TTL event_date + INTERVAL 30 DAY'
      )
    ).toThrow()
  })

  test('rejects a plain SELECT', () => {
    expect(() => parseMutationSql('SELECT * FROM events')).toThrow()
  })

  test('rejects a mutation without a WHERE clause', () => {
    expect(() => parseMutationSql('ALTER TABLE events DELETE')).toThrow()
  })
})

describe('quoteIdentifier', () => {
  test('backtick-quotes an identifier', () => {
    expect(quoteIdentifier('events')).toBe('`events`')
  })

  test('escapes embedded backticks', () => {
    expect(quoteIdentifier('a`b')).toBe('`a``b`')
  })
})

describe('estimateMutationImpact', () => {
  test('never sends the mutation SQL itself to ClickHouse', async () => {
    mockFetchData.mockClear()
    mockFetchData.mockImplementation(async () => ({ data: [], error: null }))
    mockCheckTableExists.mockResolvedValue(true)

    await estimateMutationImpact({
      sql: 'ALTER TABLE analytics.events DELETE WHERE id = 1',
      hostId: 0,
    })

    for (const call of mockFetchData.mock.calls) {
      const query: string = call[0].query
      expect(query).not.toMatch(/^\s*ALTER\s+TABLE/i)
    }
  })

  test('estimates rows matched, parts/bytes, duration, and disk sufficiency', async () => {
    mockFetchData.mockClear()
    mockCheckTableExists.mockResolvedValue(true)
    mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes('SELECT count() AS matched')) {
        return { data: [{ matched: 1000 }], error: null }
      }
      if (query.includes('FROM system.parts')) {
        return {
          data: [{ parts: 4, bytes: 1_000_000_000, rows: 10_000_000 }],
          error: null,
        }
      }
      if (query.includes('FROM system.part_log')) {
        return {
          data: [{ bytes: 500_000_000, duration_ms: 5_000 }],
          error: null,
        }
      }
      if (query.includes('FROM system.disks')) {
        return {
          data: [{ name: 'default', free_space: 10_000_000_000 }],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const result = await estimateMutationImpact({
      sql: 'ALTER TABLE analytics.events DELETE WHERE user_id = 42',
      hostId: 0,
    })

    expect(result.mutationKind).toBe('DELETE')
    expect(result.database).toBe('analytics')
    expect(result.table).toBe('events')
    expect(result.estRowsMatched).toBe(1000)
    expect(result.estActiveParts).toBe(4)
    expect(result.estBytesToRewrite).toBe(1_000_000_000)
    // throughput = 500_000_000 bytes / 5_000 ms = 100_000 bytes/ms
    expect(result.estDurationMs).toBe(10_000)
    expect(result.disk).not.toBeNull()
    expect(result.disk!.name).toBe('default')
    expect(result.disk!.requiredBytes).toBe(
      Math.round(1_000_000_000 * DISK_SAFETY_FACTOR)
    )
    expect(result.disk!.sufficient).toBe(true)
    expect(result.confidence).toBe('high')
    expect(typeof result.summary).toBe('string')
    expect(result.summary).toContain('analytics.events')
  })

  test('flags insufficient free disk space', async () => {
    mockFetchData.mockClear()
    mockCheckTableExists.mockResolvedValue(true)
    mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes('SELECT count() AS matched')) {
        return { data: [{ matched: 5 }], error: null }
      }
      if (query.includes('FROM system.parts')) {
        return {
          data: [{ parts: 2, bytes: 100_000_000_000, rows: 1_000_000 }],
          error: null,
        }
      }
      if (query.includes('FROM system.part_log')) {
        return { data: [], error: null }
      }
      if (query.includes('FROM system.disks')) {
        return {
          data: [{ name: 'default', free_space: 1_000_000 }],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const result = await estimateMutationImpact({
      sql: 'ALTER TABLE events DELETE WHERE id = 1',
      hostId: 0,
    })

    expect(result.disk!.sufficient).toBe(false)
    expect(result.estDurationMs).toBeNull()
    expect(result.confidence).toBe('medium')
    expect(result.warnings.some((w) => /free space|disk/i.test(w))).toBe(true)
  })

  test('reports low confidence and a no-op warning when no parts/rows match', async () => {
    mockFetchData.mockClear()
    mockCheckTableExists.mockResolvedValue(false)
    mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes('SELECT count() AS matched')) {
        return { data: [{ matched: 0 }], error: null }
      }
      if (query.includes('FROM system.parts')) {
        return { data: [{ parts: 0, bytes: 0, rows: 0 }], error: null }
      }
      if (query.includes('FROM system.disks')) {
        return { data: [], error: null }
      }
      return { data: [], error: null }
    })

    const result = await estimateMutationImpact({
      sql: 'ALTER TABLE events DELETE WHERE id = -1',
      hostId: 0,
    })

    expect(result.estActiveParts).toBe(0)
    expect(result.estDurationMs).toBeNull()
    expect(result.disk).toBeNull()
    expect(result.confidence).toBe('low')
    expect(result.warnings.some((w) => /no active parts/i.test(w))).toBe(true)
  })
})
