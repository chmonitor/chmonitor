import { expect, mock, test } from 'bun:test'

const DATABASE = 'analytics'
const TABLE = 'events_raw'
const CALL_DELAY_MS = 80

type FetchCall = {
  query: string
  query_params?: Record<string, unknown>
  delayMs: number
  bytes: number
}

const calls: FetchCall[] = []

const tableRow = {
  partition_key: 'toYYYYMM(event_date)',
  sorting_key: '`user_id`, status',
}

const columnRows = [
  {
    position: 2,
    name: 'status',
    type: 'LowCardinality(String)',
    is_in_partition_key: 0,
    is_in_sorting_key: '1',
    data_compressed_bytes: '300',
    data_uncompressed_bytes: 900,
  },
  {
    position: 0,
    name: 'event_date',
    type: 'Date',
    is_in_partition_key: 1,
    is_in_sorting_key: 0,
    data_compressed_bytes: 100,
    data_uncompressed_bytes: '400',
  },
  {
    position: 1,
    name: 'user_id',
    type: 'UInt64',
    is_in_partition_key: '0',
    is_in_sorting_key: 1,
    data_compressed_bytes: 200,
    data_uncompressed_bytes: 800,
  },
]

const indexRows = [
  {
    name: 'idx_status',
    type: 'set(0)',
    expression: 'status',
    granularity: '4',
  },
  {
    name: 'idx_user',
    type: 'bloom_filter',
    expression: 'user_id',
    granularity: 1,
  },
]

const TABLES_SQL =
  'SELECT partition_key, sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String}'
const COLUMNS_SQL =
  'SELECT name, type, is_in_partition_key, is_in_sorting_key, data_compressed_bytes, data_uncompressed_bytes FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position'
const INDEXES_SQL =
  'SELECT name, type, expression, granularity FROM system.data_skipping_indexes WHERE database = {database:String} AND table = {table:String}'

function isCombinedSchemaQuery(query: string): boolean {
  return (
    query.includes('system.tables') &&
    query.includes('system.columns') &&
    query.includes('system.data_skipping_indexes')
  )
}

function rowsFor(query: string): unknown[] {
  if (isCombinedSchemaQuery(query)) {
    return [
      {
        partition_key: tableRow.partition_key,
        sorting_key: tableRow.sorting_key,
        columns: columnRows.map((column) => [
          column.position,
          column.name,
          column.type,
          column.is_in_partition_key,
          column.is_in_sorting_key,
          column.data_compressed_bytes,
          column.data_uncompressed_bytes,
        ]),
        skip_indexes: indexRows.map((index) => [
          index.name,
          index.type,
          index.expression,
          index.granularity,
        ]),
      },
    ]
  }
  if (query.includes('system.columns')) {
    return [...columnRows].sort((a, b) => a.position - b.position)
  }
  if (query.includes('system.data_skipping_indexes')) return indexRows
  if (query.includes('system.tables')) return [tableRow]
  return []
}

async function runReadonlyFetch(options: {
  query: string
  hostId?: number
  query_params?: Record<string, unknown>
}): Promise<{ data: unknown[]; error: null }> {
  const started = performance.now()
  await Bun.sleep(CALL_DELAY_MS)
  const data = rowsFor(options.query)
  const bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength
  calls.push({
    query: options.query,
    query_params: options.query_params,
    delayMs: performance.now() - started,
    bytes,
  })
  return { data, error: null }
}

mock.module('../tools/helpers', () => ({ runReadonlyFetch }))

const { fetchTableSchema } = await import('../tools/advisor/data-fetchers')
const helpers = await import('../tools/helpers')

function truthy(v: number | string) {
  return Number(v) === 1
}

function splitKey(key: string) {
  return key
    ? key
        .split(',')
        .map((s) => s.trim().replace(/^[`"]|[`"]$/g, ''))
        .filter(Boolean)
    : []
}

function extractIdentifierTokens(expr: string) {
  return [...expr.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)].map((m) => m[0])
}

async function threeReadBaseline() {
  const params = { database: DATABASE, table: TABLE }
  const [tableRows, columnRowsResult, indexRowsResult] = await Promise.all([
    helpers.runReadonlyFetch({
      query: TABLES_SQL,
      hostId: 0,
      query_params: params,
    }),
    helpers.runReadonlyFetch({
      query: COLUMNS_SQL,
      hostId: 0,
      query_params: params,
    }),
    helpers.runReadonlyFetch({
      query: INDEXES_SQL,
      hostId: 0,
      query_params: params,
    }),
  ])
  const table = (tableRows.data as Array<typeof tableRow>)[0]
  const columns = columnRowsResult.data as typeof columnRows
  const indexes = indexRowsResult.data as typeof indexRows
  return {
    database: DATABASE,
    table: TABLE,
    partitionKeyColumns: extractIdentifierTokens(table?.partition_key ?? ''),
    sortingKeyColumns: splitKey(table?.sorting_key ?? ''),
    columns: columns.map((c) => ({
      name: c.name,
      type: c.type,
      isInPartitionKey: truthy(c.is_in_partition_key),
      isInSortingKey: truthy(c.is_in_sorting_key),
      compressedBytes: Number(c.data_compressed_bytes),
      uncompressedBytes: Number(c.data_uncompressed_bytes),
    })),
    existingSkipIndexes: indexes.map((i) => ({
      name: i.name,
      type: i.type,
      expression: i.expression,
      granularity: Number(i.granularity),
    })),
  }
}

test('fetchTableSchema reads one table schema in a single read-only query', async () => {
  calls.length = 0
  const baseline = await threeReadBaseline()
  const baselineCalls = calls.splice(0, calls.length)
  expect(baselineCalls).toHaveLength(3)
  const unitDelaySum = baselineCalls.reduce(
    (sum, call) => sum + call.delayMs,
    0
  )
  expect(baselineCalls.every((call) => call.bytes > 0)).toBe(true)

  const ratios: Array<{ invocationRatio: number; makespanRatio: number }> = []
  for (const run of [1, 2]) {
    const started = performance.now()
    const schema = await fetchTableSchema(0, DATABASE, TABLE)
    const makespan = performance.now() - started
    const runCalls = calls.splice(0, calls.length)
    const invocationRatio = runCalls.length / 3
    const makespanRatio = makespan / unitDelaySum
    ratios.push({ invocationRatio, makespanRatio })
    console.log(
      `table-schema batch run ${run} invocationRatio=${invocationRatio} makespanRatio=${makespanRatio} calls=${runCalls.length} bytes=${runCalls.map((call) => call.bytes).join(',')} delaysMs=${runCalls.map((call) => call.delayMs.toFixed(1)).join(',')}`
    )

    expect(invocationRatio).toBeLessThanOrEqual(0.5)
    expect(makespanRatio).toBeLessThanOrEqual(0.5)
    expect(schema).toEqual(baseline)
    expect(runCalls).toHaveLength(1)
    expect(runCalls[0]?.query_params).toEqual({
      database: DATABASE,
      table: TABLE,
    })
    expect(runCalls[0]?.query.includes(DATABASE)).toBe(false)
    expect(runCalls[0]?.query.includes(TABLE)).toBe(false)
    expect(runCalls[0]?.bytes).toBeGreaterThan(0)
  }

  console.log(
    `table-schema batch ratios ${JSON.stringify(ratios)} unitDelaySumMs=${unitDelaySum.toFixed(1)}`
  )
})
