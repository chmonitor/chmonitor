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
const UNIT_MS = 80

const TABLES_SQL =
  'SELECT partition_key, sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String}'
const COLUMNS_SQL =
  'SELECT name, type, is_in_partition_key, is_in_sorting_key, data_compressed_bytes, data_uncompressed_bytes FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position'
const INDEXES_SQL =
  'SELECT name, type, expression, granularity FROM system.data_skipping_indexes WHERE database = {database:String} AND table = {table:String}'

type QueryCall = {
  query: string
  hostId: number
  query_params?: Record<string, unknown>
}

type Sample = { delayMs: number; bytes: number; started: number; ended: number }

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

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

test('fetchTableSchema reads one table schema in a single query', async () => {
  const samples: Sample[] = []

  async function query(options: QueryCall): Promise<unknown> {
    const started = performance.now()
    await sleep(UNIT_MS)
    const sql = options.query
    let payload: unknown
    if (sql.includes('groupArray')) {
      expect(options.query_params).toEqual({ database: DATABASE, table: TABLE })
      expect(sql.includes(DATABASE)).toBe(false)
      expect(sql.includes(TABLE)).toBe(false)
      payload = [
        {
          partition_key: tableRow.partition_key,
          sorting_key: tableRow.sorting_key,
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
    } else if (sql === COLUMNS_SQL) {
      payload = [...columnRows].sort((a, b) => a.position - b.position)
    } else if (sql === INDEXES_SQL) {
      payload = indexRows
    } else if (sql === TABLES_SQL) {
      payload = [tableRow]
    } else {
      throw new Error(`unexpected query: ${sql}`)
    }

    const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength
    const ended = performance.now()
    samples.push({ delayMs: ended - started, bytes, started, ended })
    return payload
  }

  const [tables, columns, indexes] = await Promise.all([
    query({
      query: TABLES_SQL,
      hostId: HOST_ID,
      query_params: { database: DATABASE, table: TABLE },
    }),
    query({
      query: COLUMNS_SQL,
      hostId: HOST_ID,
      query_params: { database: DATABASE, table: TABLE },
    }),
    query({
      query: INDEXES_SQL,
      hostId: HOST_ID,
      query_params: { database: DATABASE, table: TABLE },
    }),
  ])
  const baseline = baselineFromReads(
    tables as Array<{ partition_key: string; sorting_key: string }>,
    columns as typeof columnRows,
    indexes as typeof indexRows
  )
  const baselineDelays = samples.splice(0, samples.length)
  expect(baselineDelays).toHaveLength(3)
  const delaySum = baselineDelays.reduce(
    (sum, sample) => sum + sample.delayMs,
    0
  )
  expect(baselineDelays.every((sample) => sample.bytes > 0)).toBe(true)

  for (const run of [1, 2]) {
    const before = samples.length
    const schema = await fetchTableSchema(HOST_ID, DATABASE, TABLE, query)
    const runSamples = samples.slice(before)
    const invocationCount = runSamples.length
    const makespan =
      Math.max(...runSamples.map((sample) => sample.ended)) -
      Math.min(...runSamples.map((sample) => sample.started))
    const invocationRatio = invocationCount / 3
    const makespanRatio = makespan / delaySum
    console.log(
      JSON.stringify({
        run,
        invocationRatio,
        makespanRatio,
        invocationCount,
        makespan,
        delaySum,
      })
    )
    expect(invocationCount).toBeLessThanOrEqual(0.5 * 3)
    expect(makespan).toBeLessThanOrEqual(0.5 * delaySum)
    expect(schema).toEqual(baseline)
  }
})
