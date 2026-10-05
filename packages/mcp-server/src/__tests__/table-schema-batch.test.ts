import { afterAll, expect, mock, test } from 'bun:test'

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

/**
 * Model a table that is absent from `system.tables`. The batched query yields
 * exactly one row with empty strings and empty arrays (the `system.tables`
 * scalar subquery returns NULL -> `ifNull` -> ''), verified against ClickHouse
 * 26.5; `no-row` models the zero-row shape the pre-batch `system.tables` read
 * returned. Both must degrade to the same empty schema.
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

// WHY the eager spread AND the restore: `mock.module` patches the registry for
// the whole `bun test` process. Returning only `runReadonlyFetch` dropped
// `toJsonResult`/`toErrorResult`/`capResultRows`/`truncationNote`, and keeping
// the stub past this file made every other tool's read go through it instead of
// its own `fetchData` mock — 17 tests across 7 files failed. Snapshot the real
// exports now, override one function, and put the real module back in
// `afterAll`, the same shape `server-sweep.test.ts` uses (issue #2672).
const realHelpers = { ...(await import('../tools/helpers')) }

mock.module('../tools/helpers', () => ({ ...realHelpers, runReadonlyFetch }))

const { fetchTableSchema } = await import('../tools/advisor/data-fetchers')
const helpers = await import('../tools/helpers')

afterAll(() => {
  mock.module('../tools/helpers', () => ({ ...realHelpers }))
})

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
  absentShape = null
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
