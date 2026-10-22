import { afterAll, expect, mock, test } from 'bun:test'

const DATABASE = 'analytics'
const TABLE = 'events_raw'
/** Each read costs one logical tick. No wall-clock time is ever measured. */
const READ_TICKS = 1

type FetchCall = {
  query: string
  query_params?: Record<string, unknown>
  start: number
  end: number
  bytes: number
}

const calls: FetchCall[] = []
// Logical clock: a read starts at the current tick and the clock only moves
// forward when a read finishes. Reads awaited one after another therefore line
// up end to start; reads issued together share the same start tick.
let clock = 0

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
    expr: 'status',
    granularity: '4',
  },
  {
    name: 'idx_user',
    type: 'bloom_filter',
    expr: 'user_id',
    granularity: 1,
  },
]

const TABLES_SQL =
  'SELECT partition_key, sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String}'
const COLUMNS_SQL =
  'SELECT name, type, is_in_partition_key, is_in_sorting_key, data_compressed_bytes, data_uncompressed_bytes FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position'
const INDEXES_SQL =
  'SELECT name, type, expr, granularity FROM system.data_skipping_indices WHERE database = {database:String} AND table = {table:String}'

function isCombinedSchemaQuery(query: string): boolean {
  return (
    query.includes('system.tables') &&
    query.includes('system.columns') &&
    query.includes('system.data_skipping_indices')
  )
}

/**
 * A table absent from `system.tables`. The batched query yields one row of empty
 * strings/arrays (scalar subquery NULL -> `ifNull` -> '', verified on 26.5);
 * `no-row` is the zero-row shape. Both must degrade to the same empty schema.
 */
let absentShape: 'empty-row' | 'no-row' | null = null

function rowsFor(query: string): unknown[] {
  if (isCombinedSchemaQuery(query)) {
    if (absentShape === 'empty-row') {
      return [
        { partition_key: '', sorting_key: '', columns: [], skip_indexes: [] },
      ]
    }
    if (absentShape === 'no-row') return []
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
          index.expr,
          index.granularity,
        ]),
      },
    ]
  }
  if (query.includes('system.columns')) {
    return [...columnRows].sort((a, b) => a.position - b.position)
  }
  if (query.includes('system.data_skipping_indices')) return indexRows
  if (query.includes('system.tables')) return [tableRow]
  return []
}

async function runReadonlyFetch(options: {
  query: string
  hostId?: number
  query_params?: Record<string, unknown>
}): Promise<{ data: unknown[]; error: null }> {
  const start = clock
  await Promise.resolve()
  const end = start + READ_TICKS
  clock = Math.max(clock, end)
  const data = rowsFor(options.query)
  const bytes = new TextEncoder().encode(JSON.stringify(data)).byteLength
  calls.push({
    query: options.query,
    query_params: options.query_params,
    start,
    end,
    bytes,
  })
  return { data, error: null }
}

// WHY the eager spread AND the restore: `mock.module` patches the registry for
// the whole `bun test` process. Returning only `runReadonlyFetch` dropped the
// other helpers, and keeping the stub past this file rerouted every other tool's
// read away from its own `fetchData` mock. Snapshot the real exports, override
// one, and restore in `afterAll`.
const realHelpers = { ...(await import('../tools/helpers')) }

mock.module('../tools/helpers', () => ({ ...realHelpers, runReadonlyFetch }))

const { fetchTableSchema } = await import('../tools/advisor/data-fetchers')
const helpers = await import('../tools/helpers')

afterAll(() => {
  mock.module('../tools/helpers', () => ({ ...realHelpers }))
})

/** Logical makespan: ticks from the first read starting to the last one ending. */
function rounds(readCalls: FetchCall[]): number {
  if (readCalls.length === 0) {
    throw new Error('no read was recorded, so there is nothing to count')
  }
  return (
    Math.max(...readCalls.map((call) => call.end)) -
    Math.min(...readCalls.map((call) => call.start))
  )
}

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
      expression: i.expr,
      granularity: Number(i.granularity),
    })),
  }
}

test('fetchTableSchema reads one table schema in a single read-only query', async () => {
  calls.length = 0
  absentShape = null
  const baseline = await threeReadBaseline()
  const baselineCalls = calls.splice(0, calls.length)
  expect(baselineCalls).toHaveLength(3)
  // Uncoordinated path: three reads issued together, but each one is a unit of
  // work the batch has to beat, so the cost to beat is the sum of their ticks.
  const unitTickSum = baselineCalls.reduce(
    (sum, call) => sum + (call.end - call.start),
    0
  )
  expect(unitTickSum).toBe(3 * READ_TICKS)
  expect(baselineCalls.every((call) => call.bytes > 0)).toBe(true)

  const ratios: Array<{ invocationRatio: number; roundsRatio: number }> = []
  for (const run of [1, 2]) {
    const schema = await fetchTableSchema(0, DATABASE, TABLE)
    const runCalls = calls.splice(0, calls.length)
    const invocationRatio = runCalls.length / 3
    const batchedRounds = rounds(runCalls)
    const roundsRatio = batchedRounds / unitTickSum
    ratios.push({ invocationRatio, roundsRatio })
    console.log(
      `table-schema batch run ${run} invocationRatio=${invocationRatio} roundsRatio=${roundsRatio} calls=${runCalls.length} bytes=${runCalls.map((call) => call.bytes).join(',')}`
    )

    expect(invocationRatio).toBeLessThanOrEqual(0.5)
    expect(batchedRounds).toBe(READ_TICKS)
    expect(roundsRatio).toBeLessThanOrEqual(0.5)
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
    `table-schema batch ratios ${JSON.stringify(ratios)} unitTickSum=${unitTickSum}`
  )
})

test('fetchTableSchema degrades to an empty schema when the table is absent', async () => {
  const empty = {
    database: DATABASE,
    table: TABLE,
    partitionKeyColumns: [],
    sortingKeyColumns: [],
    columns: [],
    existingSkipIndexes: [],
  }
  for (const shape of ['empty-row', 'no-row'] as const) {
    calls.length = 0
    absentShape = shape
    try {
      expect(await fetchTableSchema(0, DATABASE, TABLE)).toEqual(empty)
      expect(calls).toHaveLength(1)
    } finally {
      absentShape = null
    }
  }
})
