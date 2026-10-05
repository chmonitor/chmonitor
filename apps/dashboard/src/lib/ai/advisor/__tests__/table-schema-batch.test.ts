import { expect, mock, test } from 'bun:test'

mock.module('@chm/clickhouse-client', () => ({
  fetchData: async () => ({ data: [], error: null }),
}))
mock.module('@chm/sql-builder', () => ({
  validateSqlQuery: () => {},
}))

const { fetchTableSchema } = await import('../query-context')

const DATABASE = 'zz_db'
const TABLE = 'zz_events'
const HOST_ID = 0

const COLUMNS_SQL =
  'SELECT name, type, is_in_partition_key, is_in_sorting_key, data_compressed_bytes, data_uncompressed_bytes FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position'
const INDEXES_SQL =
  'SELECT name, type, expression, granularity FROM system.data_skipping_indexes WHERE database = {database:String} AND table = {table:String}'
const TABLES_SQL =
  'SELECT partition_key, sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String}'

type QueryCall = {
  query: string
  hostId: number
  query_params?: Record<string, unknown>
}

const tableRow = {
  partition_key: 'toYYYYMM(event_date)',
  sorting_key: '`event_date`, user_id',
}

const columnRows = [
  {
    name: 'event_date',
    type: 'Date',
    is_in_partition_key: 1,
    is_in_sorting_key: 1,
    data_compressed_bytes: '500',
    data_uncompressed_bytes: 1000,
    position: 1,
  },
  {
    name: 'user_id',
    type: 'UInt64',
    is_in_partition_key: 0,
    is_in_sorting_key: '1',
    data_compressed_bytes: 1000,
    data_uncompressed_bytes: '2000',
    position: 2,
  },
  {
    name: 'payload',
    type: 'String',
    is_in_partition_key: 0,
    is_in_sorting_key: 0,
    data_compressed_bytes: 50,
    data_uncompressed_bytes: 80,
    position: 3,
  },
]

const indexRows = [
  {
    name: 'idx_user',
    type: 'bloom_filter',
    expression: 'user_id',
    granularity: '4',
  },
  {
    name: 'idx_payload',
    type: 'minmax',
    expression: 'payload',
    granularity: 1,
  },
]

function truthy(value: number | string): boolean {
  return Number(value) === 1
}

function splitKey(key: string): string[] {
  return key
    ? key
        .split(',')
        .map((part) => part.trim().replace(/^[`"]|[`"]$/g, ''))
        .filter(Boolean)
    : []
}

function extractIdentifierTokens(expr: string): string[] {
  return [...expr.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)].map((match) => match[0])
}

/** The three-read `TableSchema` the single query has to match. */
function baselineFromReads(
  tables: Array<{ partition_key: string; sorting_key: string }>,
  columns: typeof columnRows,
  indexes: typeof indexRows
) {
  const ordered = [...columns].sort((a, b) => a.position - b.position)
  return {
    database: DATABASE,
    table: TABLE,
    partitionKeyColumns: extractIdentifierTokens(
      tables[0]?.partition_key ?? ''
    ),
    sortingKeyColumns: splitKey(tables[0]?.sorting_key ?? ''),
    columns: ordered.map((column) => ({
      name: column.name,
      type: column.type,
      isInPartitionKey: truthy(column.is_in_partition_key),
      isInSortingKey: truthy(column.is_in_sorting_key),
      compressedBytes: Number(column.data_compressed_bytes),
      uncompressedBytes: Number(column.data_uncompressed_bytes),
    })),
    existingSkipIndexes: indexes.map((index) => ({
      name: index.name,
      type: index.type,
      expression: index.expression,
      granularity: Number(index.granularity),
    })),
  }
}

/** Fields of each `groupArray(tuple(...))`, in SQL order. */
function tupleFields(sql: string): string[][] {
  return [...sql.matchAll(/groupArray\(\s*tuple\(([^()]*)\)\s*\)/g)].map(
    (match) =>
      match[1]
        .split(',')
        .map((field) => field.trim())
        .filter(Boolean)
  )
}

test('fetchTableSchema reads one table schema in a single query', async () => {
  const calls: QueryCall[] = []

  async function query(options: QueryCall): Promise<unknown> {
    calls.push(options)
    const sql = options.query
    if (sql.includes('groupArray')) {
      // The tuple payload arrives positionally; ClickHouse emits Array(Tuple)
      // as JSON arrays of arrays in JSONEachRow.
      return [
        {
          partition_key: tableRow.partition_key,
          sorting_key: tableRow.sorting_key,
          // Deliberately out of position order so an unsorted decode fails.
          columns: [
            [3, 'payload', 'String', 0, 0, 50, 80],
            [1, 'event_date', 'Date', 1, 1, '500', 1000],
            [2, 'user_id', 'UInt64', 0, '1', 1000, '2000'],
          ],
          skip_indexes: [
            ['idx_user', 'bloom_filter', 'user_id', '4'],
            ['idx_payload', 'minmax', 'payload', 1],
          ],
        },
      ]
    }
    throw new Error(`unexpected query: ${sql}`)
  }

  // Baseline: the three uncoordinated reads this change replaces.
  const baseline = baselineFromReads([tableRow], columnRows, indexRows)
  calls.length = 0

  const schema = await fetchTableSchema(HOST_ID, DATABASE, TABLE, query)

  // The claim under test: exactly one read, and it is the whole schema.
  expect(calls).toHaveLength(1)
  expect(schema).toEqual(baseline)

  const sql = calls[0].query
  expect(calls[0].hostId).toBe(HOST_ID)

  // One statement covering all three sources. The skip-index name is matched as
  // a bare prefix so it holds for the shipped name and for a corrected one,
  // while still rejecting a different system table.
  expect(sql.trim().toUpperCase()).toMatch(/^SELECT\b/)
  expect(sql).toContain('FROM system.tables')
  expect(sql).toContain('FROM system.columns')
  expect(sql).toContain('FROM system.data_skipping_index')
  // Column order used to come from `ORDER BY position`; inside `groupArray` it
  // has to come from sorting the aggregate on the first tuple field instead.
  expect(sql).toMatch(/arraySort\(\s*\w+\s*->\s*\w+\.1/)
  for (const legacy of [COLUMNS_SQL, INDEXES_SQL, TABLES_SQL]) {
    expect(sql).not.toContain(legacy)
  }

  // The positional decode (`tupleAt(0..6)`) is only correct while the SQL field
  // order holds — a swapped field would silently pair every column with the
  // wrong name/type/bytes, so pin the order here.
  const [columnFields, skipIndexFields] = tupleFields(sql)
  expect(columnFields).toEqual([
    'position',
    'name',
    'type',
    'is_in_partition_key',
    'is_in_sorting_key',
    'data_compressed_bytes',
    'data_uncompressed_bytes',
  ])
  // Four fields; the decoder anchors on `name` (0) and `granularity` (3).
  expect(skipIndexFields).toHaveLength(4)
  expect(skipIndexFields[0]).toBe('name')
  expect(skipIndexFields[3]).toBe('granularity')

  // Identifiers travel as bound parameters only — never interpolated.
  expect(calls[0].query_params).toEqual({ database: DATABASE, table: TABLE })
  expect(sql.includes(DATABASE)).toBe(false)
  expect(sql.includes(TABLE)).toBe(false)
  expect(sql).toContain('{database:String}')
  expect(sql).toContain('{table:String}')
})

test('a table with no rows in system.tables still costs one read', async () => {
  const calls: QueryCall[] = []
  const schema = await fetchTableSchema(
    HOST_ID,
    DATABASE,
    'zz_missing',
    async (options) => {
      calls.push(options)
      return [
        { partition_key: '', sorting_key: '', columns: [], skip_indexes: [] },
      ]
    }
  )

  expect(calls).toHaveLength(1)
  expect(calls[0].query_params).toEqual({
    database: DATABASE,
    table: 'zz_missing',
  })
  expect(schema).toEqual({
    database: DATABASE,
    table: 'zz_missing',
    partitionKeyColumns: [],
    sortingKeyColumns: [],
    columns: [],
    existingSkipIndexes: [],
  })
})

test('a failing read rejects so the caller can surface the error', async () => {
  await expect(
    fetchTableSchema(HOST_ID, DATABASE, TABLE, async () => {
      throw new Error('boom')
    })
  ).rejects.toThrow('boom')
})
