import { mockFetchData } from './shared-mocks'
import { describe, expect, test } from 'bun:test'

const databases = [
  { name: 'system', engine: 'Atomic', comment: 'System database' },
  { name: 'analytics', engine: 'Atomic', comment: '' },
]

const tables = Array.from({ length: 5 }, (_, i) => ({
  name: `table_${i}`,
  engine: 'MergeTree',
  total_rows: (i + 1) * 100000,
  size: `${(i + 1) * 100}.00 MiB`,
}))

const columns = [
  {
    name: 'event_date',
    type: 'Date',
    default_kind: '',
    default_expression: '',
    comment: 'Partition column',
  },
  {
    name: 'tenant_id',
    type: 'UInt64',
    default_kind: '',
    default_expression: '',
    comment: '',
  },
  {
    name: 'status',
    type: 'String',
    default_kind: 'DEFAULT',
    default_expression: "'active'",
    comment: '',
  },
]

const indexes = [
  {
    name: 'idx_status',
    type: 'bloom_filter',
    expression: 'status',
    granularity: 1,
  },
]

const partitions = [{ partition: '202605', parts: 5, inactive_parts: 0 }]

const constraints = [
  {
    partition_key: 'toYYYYMM(event_date)',
    primary_key: 'event_date',
    sorting_key: '(event_date, tenant_id)',
  },
]

const fkCandidates = [
  { column_name: 'tenant_id', column_type: 'UInt64' },
  { column_name: 'user_key', column_type: 'String' },
]

/** Default mock router for schema tools queries. */
function setupSchemaMocks(overrides?: {
  tablesSize?: unknown[]
  tablesName?: unknown[]
}) {
  mockFetchData.mockImplementation(
    async ({
      query,
      query_params,
    }: {
      query: string
      query_params?: Record<string, unknown>
    }) => {
      const params = query_params ?? {}

      if (
        query.includes('system.databases') &&
        !query.includes('system.tables')
      )
        return { data: databases, error: null }

      if (
        query.includes('system.tables') &&
        query.includes('total_bytes') &&
        query.includes('ORDER BY total_bytes')
      ) {
        if (params.database === 'empty_db') return { data: [], error: null }
        return { data: overrides?.tablesSize ?? tables, error: null }
      }

      if (query.includes('system.tables') && query.includes('ORDER BY name')) {
        return { data: overrides?.tablesName ?? tables, error: null }
      }

      if (
        query.includes('system.columns') &&
        query.includes('ORDER BY position')
      ) {
        if (params.table === 'empty_table') return { data: [], error: null }
        return { data: columns, error: null }
      }

      if (query.includes('system.data_skipping_indexes'))
        return { data: indexes, error: null }

      if (
        query.includes('system.parts') &&
        query.includes('GROUP BY partition')
      )
        return { data: partitions, error: null }

      if (query.includes('partition_key') && query.includes('primary_key'))
        return { data: constraints, error: null }

      if (query.includes('%_id') || query.includes('%_key'))
        return { data: fkCandidates, error: null }

      return { data: [{ result: 'query data' }], error: null }
    }
  )
}

const { createSchemaTools } = await import('../schema-tools')

describe('createSchemaTools', () => {
  test('creates all schema tools', () => {
    const tools = createSchemaTools(0) as any
    expect(tools.query).toBeDefined()
    expect(tools.list_databases).toBeDefined()
    expect(tools.list_tables).toBeDefined()
    expect(tools.get_table_schema).toBeDefined()
    expect(tools.explore_table_schema).toBeDefined()
  })

  describe('query', () => {
    test('executes validated read-only query', async () => {
      setupSchemaMocks()

      const tools = createSchemaTools(0) as any

      const result = await tools.query.execute({
        sql: 'SELECT * FROM system.tables LIMIT 10',
      })

      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data[0].result).toBe('query data')
      expect(result.truncated).toBe(false)
      expect(result.note).toBeUndefined()
    })

    test('uses provided hostId', async () => {
      setupSchemaMocks()

      const tools = createSchemaTools(0) as any

      const result = await tools.query.execute({
        sql: 'SELECT 1',
        hostId: 2,
      })

      expect(Array.isArray(result.data)).toBe(true)
    })

    test('caps results at 1000 rows and flags truncation', async () => {
      mockFetchData.mockImplementation(async () => ({
        data: Array.from({ length: 1500 }, (_, i) => ({ id: i })),
        error: null,
      }))

      const tools = createSchemaTools(0) as any

      const result = await tools.query.execute({
        sql: 'SELECT id FROM big_table',
      })

      expect(result.data).toHaveLength(1000)
      expect(result.truncated).toBe(true)
      expect(result.note).toContain('truncated to 1000 rows')
    })

    test('does not truncate results at or under 1000 rows', async () => {
      mockFetchData.mockImplementation(async () => ({
        data: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
        error: null,
      }))

      const tools = createSchemaTools(0) as any

      const result = await tools.query.execute({
        sql: 'SELECT id FROM medium_table',
      })

      expect(result.data).toHaveLength(1000)
      expect(result.truncated).toBe(false)
      expect(result.note).toBeUndefined()
    })
  })

  describe('list_databases', () => {
    test('returns list of databases', async () => {
      setupSchemaMocks()

      const tools = createSchemaTools(0) as any
      const result = await tools.list_databases.execute({})

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('system')
      expect(result[1].name).toBe('analytics')
    })
  })

  describe('list_tables', () => {
    test('returns tables for a database', async () => {
      setupSchemaMocks()

      const tools = createSchemaTools(0) as any
      const result = await tools.list_tables.execute({
        database: 'analytics',
      })

      expect(result.tables).toHaveLength(5)
      expect(result.truncated).toBe(false)
      expect(result.note).toBeUndefined()
    })

    test('returns empty tables for empty database', async () => {
      setupSchemaMocks()

      const tools = createSchemaTools(0) as any
      const result = await tools.list_tables.execute({
        database: 'empty_db',
      })

      expect(result.tables).toHaveLength(0)
      expect(result.truncated).toBe(false)
    })

    test('marks truncated when result hits limit', async () => {
      mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
        if (query.includes('total_bytes') && query.includes('DESC')) {
          return {
            data: Array.from({ length: 500 }, (_, i) => ({
              name: `t${i}`,
              engine: 'MergeTree',
              total_rows: 0,
              size: '0 B',
            })),
            error: null,
          }
        }
        return { data: [], error: null }
      })

      const tools = createSchemaTools(0) as any
      const result = await tools.list_tables.execute({
        database: 'big_db',
      })

      expect(result.truncated).toBe(true)
      expect(result.note).toContain('Showing the largest 500')
    })
  })

  describe('get_table_schema', () => {
    test('returns column schema for a table', async () => {
      setupSchemaMocks()

      const tools = createSchemaTools(0) as any

      const result = await tools.get_table_schema.execute({
        database: 'analytics',
        table: 'events',
      })

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(3)
      expect(result[0].name).toBe('event_date')
      expect(result[1].type).toBe('UInt64')
    })

    test('returns empty for nonexistent table', async () => {
      setupSchemaMocks()

      const tools = createSchemaTools(0) as any

      const result = await tools.get_table_schema.execute({
        database: 'analytics',
        table: 'empty_table',
      })

      expect(Array.isArray(result)).toBe(true)
      expect(result).toHaveLength(0)
    })
  })

  describe('explore_table_schema', () => {
    test('mode databases: lists all databases when no params', async () => {
      setupSchemaMocks()

      const tools = createSchemaTools(0) as any
      const result = await tools.explore_table_schema.execute({})

      expect(result.mode).toBe('databases')
      expect(result.data).toHaveLength(2)
    })

    test('mode tables: lists tables when only database provided', async () => {
      setupSchemaMocks()

      const tools = createSchemaTools(0) as any
      const result = await tools.explore_table_schema.execute({
        database: 'analytics',
      })

      expect(result.mode).toBe('tables')
      expect(result.database).toBe('analytics')
      expect(result.data).toHaveLength(5)
      expect(result.truncated).toBe(false)
    })

    test('mode tables: marks truncated at 500 limit', async () => {
      mockFetchData.mockImplementation(async () => ({
        data: Array.from({ length: 500 }, (_, i) => ({
          name: `t${i}`,
          engine: 'MergeTree',
          total_rows: 0,
          size: '0 B',
        })),
        error: null,
      }))

      const tools = createSchemaTools(0) as any
      const result = await tools.explore_table_schema.execute({
        database: 'big_db',
      })

      expect(result.truncated).toBe(true)
      expect(result.note).toContain('first 500')
    })

    test('mode schema: returns full schema when database and table provided', async () => {
      setupSchemaMocks()

      const tools = createSchemaTools(0) as any
      const result = await tools.explore_table_schema.execute({
        database: 'analytics',
        table: 'events',
      })

      expect(result.mode).toBe('schema')
      expect(result.database).toBe('analytics')
      expect(result.table).toBe('events')
      expect(result.columns).toHaveLength(3)
      expect(result.indexes).toHaveLength(1)
      expect(result.partitions).toHaveLength(1)
      expect(result.constraints).toHaveLength(1)
      expect(result.foreignKeys).toHaveLength(2)
    })

    test('mode schema: handles FK query failure gracefully', async () => {
      mockFetchData.mockImplementation(
        async ({
          query,
        }: {
          query: string
          query_params?: Record<string, unknown>
        }) => {
          if (
            query.includes('system.columns') &&
            query.includes('ORDER BY position')
          )
            return { data: columns, error: null }
          if (query.includes('system.data_skipping_indexes'))
            return { data: indexes, error: null }
          if (query.includes('system.parts') && query.includes('active = 1'))
            return { data: partitions, error: null }
          if (query.includes('partition_key') && query.includes('primary_key'))
            return { data: constraints, error: null }

          // FK query — fail
          if (query.includes('%_id') || query.includes('%_key')) {
            throw new Error('FK query failed')
          }

          return { data: [], error: null }
        }
      )

      const tools = createSchemaTools(0) as any
      const result = await tools.explore_table_schema.execute({
        database: 'analytics',
        table: 'events',
      })

      expect(result.mode).toBe('schema')
      expect(result.foreignKeys).toEqual([])
    })
  })
})
