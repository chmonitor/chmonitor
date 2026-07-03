// @ts-nocheck — test file, only runs under bun:test
import { describe, expect, mock, test } from 'bun:test'

// bun test runs with --isolate (see apps/dashboard/package.json), so
// mock.module() here is scoped to this file's process and cannot leak into
// or collide with apps/dashboard/src/lib/ai/agent/tools/__tests__/shared-mocks.ts.
// NOTE: '@chm/sql-builder' is intentionally NOT mocked here — the "never
// executes/mutates" tests below rely on the REAL validateSqlQuery rejecting
// mutating SQL before any query is sent.
const mockFetchData = mock(
  async (_params: {
    query: string
    hostId?: number
    query_params?: Record<string, unknown>
    clickhouse_settings?: Record<string, unknown>
  }) => ({
    data: [] as any[],
    error: null,
  })
) as any
mock.module('@chm/clickhouse-client', () => ({ fetchData: mockFetchData }))

const {
  parseExplainPlan,
  parseExplainJsonRows,
  estimateRowsAndMemory,
  estimateWallMs,
  estimateQueryCost,
  DEFAULT_GRANULE_ROWS,
  DEFAULT_THROUGHPUT_HINT,
} = await import('../cost-estimator')

/**
 * Fixture shapes below are grounded in ClickHouse's own test fixtures
 * (verified via github.com/ClickHouse/ClickHouse
 * tests/queries/0_stateless/01786_explain_merge_tree.reference and
 * 01823_explain_json.reference) — same field names/nesting as real
 * `EXPLAIN json = 1, header = 1, indexes = 1` output. Numeric values are
 * chosen to be simple to hand-verify, not copied from the real fixture.
 */

// --- Fixture 1: plain filtered scan, one table, two indexes applied in sequence ---
const SCAN_FIXTURE = [
  {
    Plan: {
      'Node Type': 'Expression',
      'Node Id': 'Expression_0',
      Plans: [
        {
          'Node Type': 'ReadFromMergeTree',
          'Node Id': 'ReadFromMergeTree_0',
          Description: 'default.events',
          Header: [
            { Name: 'event_id', Type: 'UInt64' },
            { Name: 'user_id', Type: 'UInt64' },
          ],
          Indexes: [
            {
              Type: 'PrimaryKey',
              Keys: ['event_date'],
              'Initial Parts': 10,
              'Selected Parts': 10,
              'Initial Granules': 1000,
              'Selected Granules': 1000,
            },
            {
              Type: 'Skip',
              Name: 'idx_user',
              'Initial Parts': 10,
              'Selected Parts': 4,
              'Initial Granules': 1000,
              'Selected Granules': 100,
            },
          ],
        },
      ],
    },
  },
]

// --- Fixture 2: JOIN of two MergeTree tables ---
const JOIN_FIXTURE = [
  {
    Plan: {
      'Node Type': 'Expression',
      Plans: [
        {
          'Node Type': 'Join',
          'Node Id': 'Join_0',
          Plans: [
            {
              'Node Type': 'ReadFromMergeTree',
              Description: 'default.orders',
              Header: [
                { Name: 'order_id', Type: 'UInt64' },
                { Name: 'user_id', Type: 'UInt64' },
              ],
              Indexes: [
                {
                  Type: 'PrimaryKey',
                  'Initial Parts': 5,
                  'Selected Parts': 5,
                  'Initial Granules': 500,
                  'Selected Granules': 500,
                },
              ],
            },
            {
              'Node Type': 'ReadFromMergeTree',
              Description: 'default.users',
              Header: [
                { Name: 'user_id', Type: 'UInt64' },
                { Name: 'name', Type: 'String' },
              ],
              Indexes: [
                {
                  Type: 'PrimaryKey',
                  'Initial Parts': 2,
                  'Selected Parts': 2,
                  'Initial Granules': 20,
                  'Selected Granules': 20,
                },
              ],
            },
          ],
        },
      ],
    },
  },
]

// --- Fixture 3: Aggregating (GROUP BY) over one table ---
const AGGREGATION_FIXTURE = [
  {
    Plan: {
      'Node Type': 'Aggregating',
      'Node Id': 'Aggregating_0',
      Keys: ['status'],
      Plans: [
        {
          'Node Type': 'Expression',
          Plans: [
            {
              'Node Type': 'ReadFromMergeTree',
              Description: 'default.events',
              Header: [{ Name: 'status', Type: 'String' }],
              Indexes: [
                {
                  Type: 'PrimaryKey',
                  'Initial Parts': 8,
                  'Selected Parts': 8,
                  'Initial Granules': 800,
                  'Selected Granules': 800,
                },
              ],
            },
          ],
        },
      ],
    },
  },
]

// --- Fixture 4: a Filter node (for hasFilter detection) ---
const FILTER_FIXTURE = [
  {
    Plan: {
      'Node Type': 'Filter',
      Description: '(status = 1)',
      Plans: [
        {
          'Node Type': 'ReadFromMergeTree',
          Description: 'default.t',
          Indexes: [],
        },
      ],
    },
  },
]

describe('parseExplainPlan', () => {
  test('extracts a ReadFromMergeTree scan with its indexes and header', () => {
    const plan = parseExplainPlan(SCAN_FIXTURE)
    expect(plan.reads).toHaveLength(1)
    expect(plan.reads[0].table).toBe('default.events')
    expect(plan.reads[0].header).toEqual([
      { name: 'event_id', type: 'UInt64' },
      { name: 'user_id', type: 'UInt64' },
    ])
    expect(plan.reads[0].indexes).toHaveLength(2)
    expect(plan.reads[0].indexes[1]).toEqual({
      type: 'Skip',
      name: 'idx_user',
      initialParts: 10,
      selectedParts: 4,
      initialGranules: 1000,
      selectedGranules: 100,
    })
    expect(plan.hasJoin).toBe(false)
    expect(plan.hasAggregation).toBe(false)
  })

  test('detects a JOIN across two ReadFromMergeTree children', () => {
    const plan = parseExplainPlan(JOIN_FIXTURE)
    expect(plan.hasJoin).toBe(true)
    expect(plan.reads).toHaveLength(2)
    expect(plan.reads.map((r) => r.table)).toEqual([
      'default.orders',
      'default.users',
    ])
  })

  test('detects an Aggregating node and its GROUP BY keys', () => {
    const plan = parseExplainPlan(AGGREGATION_FIXTURE)
    expect(plan.hasAggregation).toBe(true)
    expect(plan.aggregationKeys).toEqual(['status'])
    expect(plan.reads).toHaveLength(1)
  })

  test('detects a Filter node', () => {
    const plan = parseExplainPlan(FILTER_FIXTURE)
    expect(plan.hasFilter).toBe(true)
  })

  test('degrades gracefully (empty plan, no throw) on an unrecognized shape', () => {
    expect(parseExplainPlan({ unexpected: true })).toEqual({
      reads: [],
      hasFilter: false,
      hasJoin: false,
      hasAggregation: false,
      aggregationKeys: [],
      nodeTypes: [],
    })
    expect(parseExplainPlan(null)).toEqual(
      expect.objectContaining({ reads: [] })
    )
  })
})

describe('parseExplainJsonRows', () => {
  test('joins one-line-per-row EXPLAIN output back into parseable JSON', () => {
    const lines = JSON.stringify(SCAN_FIXTURE, null, 2).split('\n')
    const rows = lines.map((l) => ({ explain: l }))
    expect(parseExplainJsonRows(rows)).toEqual(SCAN_FIXTURE)
  })

  test('returns null (never throws) on malformed JSON', () => {
    expect(parseExplainJsonRows([{ explain: 'not json {{{' }])).toBeNull()
  })
})

describe('estimateRowsAndMemory', () => {
  test('plain scan: rows from the last (most-pruned) index, bytes from header columns, memory floored at one granule', () => {
    const plan = parseExplainPlan(SCAN_FIXTURE)
    const columnStats = new Map([
      [
        'default.events',
        {
          totalRows: 10_000_000,
          columnBytes: new Map([
            ['event_id', 80_000_000], // 8 bytes/row
            ['user_id', 80_000_000], // 8 bytes/row
            ['payload', 800_000_000], // not in header — must be excluded
          ]),
        },
      ],
    ])

    const result = estimateRowsAndMemory(plan, columnStats)

    // rows = last index's Selected Granules (100) * 8192
    expect(result.estRows).toBe(100 * DEFAULT_GRANULE_ROWS)
    // avgRowSize = (80M + 80M) / 10M = 16 bytes/row (payload excluded)
    expect(result.estBytesRead).toBe(819200 * 16)
    // no join/aggregation -> memory floors at one granule's worth
    expect(result.estPeakMemoryBytes).toBe(DEFAULT_GRANULE_ROWS * 16)
    expect(result.warnings).toEqual([])
  })

  test('JOIN: peak memory includes the smaller table as the build side', () => {
    const plan = parseExplainPlan(JOIN_FIXTURE)
    const columnStats = new Map([
      [
        'default.orders',
        {
          totalRows: 4_096_000,
          columnBytes: new Map([
            ['order_id', 32_768_000],
            ['user_id', 32_768_000],
          ]),
        },
      ],
      [
        'default.users',
        {
          totalRows: 163_840,
          columnBytes: new Map([
            ['user_id', 1_310_720],
            ['name', 1_310_720],
          ]),
        },
      ],
    ])

    const result = estimateRowsAndMemory(plan, columnStats)

    expect(result.estRows).toBe(
      500 * DEFAULT_GRANULE_ROWS + 20 * DEFAULT_GRANULE_ROWS
    )
    expect(result.estBytesRead).toBe(65_536_000 + 2_621_440)
    // build side = smaller table (users, 2,621,440 bytes) > the 1-granule floor
    expect(result.estPeakMemoryBytes).toBe(2_621_440)
    expect(result.warnings.some((w) => w.includes('JOIN'))).toBe(true)
  })

  test('Aggregation: peak memory uses total scanned bytes as a worst-case state proxy', () => {
    const plan = parseExplainPlan(AGGREGATION_FIXTURE)
    const columnStats = new Map([
      [
        'default.events',
        {
          totalRows: 6_553_600,
          columnBytes: new Map([['status', 26_214_400]]), // 4 bytes/row
        },
      ],
    ])

    const result = estimateRowsAndMemory(plan, columnStats)

    expect(result.estRows).toBe(800 * DEFAULT_GRANULE_ROWS)
    expect(result.estBytesRead).toBe(26_214_400)
    expect(result.estPeakMemoryBytes).toBe(26_214_400)
    expect(result.warnings.some((w) => w.includes('aggregation'))).toBe(true)
  })

  test('no ReadFromMergeTree step -> zeroed estimate with a clear warning, never throws', () => {
    const plan = parseExplainPlan([{ Plan: { 'Node Type': 'Expression' } }])
    const result = estimateRowsAndMemory(plan, new Map())
    expect(result).toEqual({
      estRows: 0,
      estBytesRead: 0,
      estPeakMemoryBytes: 0,
      warnings: expect.arrayContaining([
        expect.stringContaining('No ReadFromMergeTree step found'),
      ]),
    })
  })

  test('missing column stats falls back to a documented default and warns', () => {
    const plan = parseExplainPlan(SCAN_FIXTURE)
    const result = estimateRowsAndMemory(plan, new Map())
    expect(result.estRows).toBe(819200)
    expect(result.estBytesRead).toBeGreaterThan(0)
    expect(
      result.warnings.some((w) => w.includes('no column-size stats'))
    ).toBe(true)
  })
})

describe('estimateWallMs', () => {
  test('sums the bytes-throughput and rows-throughput components', () => {
    const ms = estimateWallMs(
      { estRows: 819200, estBytesRead: 13_107_200 },
      DEFAULT_THROUGHPUT_HINT
    )
    // bytesMs = 13,107,200/500,000,000*1000 = 26.2144
    // rowsMs  =    819,200/100,000,000*1000 =  8.192
    expect(ms).toBe(34)
  })

  test('a faster throughput hint yields a lower estimate', () => {
    const slow = estimateWallMs(
      { estRows: 1_000_000, estBytesRead: 1_000_000_000 },
      { bytesPerSec: 100_000_000, rowsPerSec: 10_000_000 }
    )
    const fast = estimateWallMs(
      { estRows: 1_000_000, estBytesRead: 1_000_000_000 },
      { bytesPerSec: 1_000_000_000, rowsPerSec: 100_000_000 }
    )
    expect(fast).toBeLessThan(slow)
  })
})

describe('estimateQueryCost — orchestration + safety invariants', () => {
  function explainRowsFor(fixture: unknown) {
    return JSON.stringify(fixture, null, 2)
      .split('\n')
      .map((l) => ({ explain: l }))
  }

  test('never sends the raw analyzed SQL standalone — only ever wrapped in EXPLAIN', async () => {
    const capturedQueries: string[] = []
    const capturedSettings: Array<Record<string, unknown> | undefined> = []
    mockFetchData.mockImplementation(
      async ({ query, query_params, clickhouse_settings }: any) => {
        capturedQueries.push(query)
        if (query.includes('EXPLAIN')) {
          capturedSettings.push(clickhouse_settings)
          return { data: explainRowsFor(SCAN_FIXTURE), error: null }
        }
        if (query.includes('system.columns')) {
          if (query_params?.table === 'events') {
            return {
              data: [
                {
                  name: 'event_id',
                  uncompressed_bytes: 80_000_000,
                  total_rows: 10_000_000,
                },
                {
                  name: 'user_id',
                  uncompressed_bytes: 80_000_000,
                  total_rows: 10_000_000,
                },
              ],
              error: null,
            }
          }
        }
        return { data: [], error: null }
      }
    )

    const rawSql =
      'SELECT event_id, user_id FROM default.events WHERE user_id = 5'
    const result = await estimateQueryCost({ sql: rawSql, hostId: 0 })

    // Invariant: the analyzed SQL is only ever sent wrapped in EXPLAIN. Every
    // captured query is either that EXPLAIN call or an unrelated read-only
    // metadata lookup (system.columns/system.tables) — never the raw,
    // unwrapped analyzed SQL sent standalone.
    expect(capturedQueries.length).toBeGreaterThan(0)
    expect(capturedQueries.some((q) => q.startsWith('EXPLAIN'))).toBe(true)
    for (const q of capturedQueries) {
      const isExplainCall = q.startsWith('EXPLAIN')
      const isMetadataCall = q.includes('system.columns')
      expect(isExplainCall || isMetadataCall).toBe(true)
    }
    expect(capturedQueries).not.toContain(rawSql)
    // The EXPLAIN call goes through the readonly transport.
    expect(capturedSettings[0]).toEqual({ readonly: '1' })

    // And the computed estimate matches the scan fixture's hand-derived numbers.
    expect(result.estRows).toBe(819200)
    expect(result.estBytesRead).toBe(819200 * 16)
    expect(result.confidence).toBe('high')
  })

  test('rejects a mutating statement before ever calling fetchData (never executes/mutates)', async () => {
    mockFetchData.mockClear()

    await expect(
      estimateQueryCost({
        sql: 'ALTER TABLE default.events DELETE WHERE 1',
        hostId: 0,
      })
    ).rejects.toThrow()
    expect(mockFetchData).not.toHaveBeenCalled()

    await expect(
      estimateQueryCost({ sql: 'DROP TABLE default.events', hostId: 0 })
    ).rejects.toThrow()
    expect(mockFetchData).not.toHaveBeenCalled()

    await expect(
      estimateQueryCost({
        sql: "INSERT INTO default.events VALUES (1, 'x')",
        hostId: 0,
      })
    ).rejects.toThrow()
    expect(mockFetchData).not.toHaveBeenCalled()
  })

  test('returns a low-confidence zeroed estimate (not a throw) when EXPLAIN JSON fails to parse', async () => {
    mockFetchData.mockImplementation(async ({ query }: any) => {
      if (query.includes('EXPLAIN')) {
        return { data: [{ explain: 'not valid json {{{' }], error: null }
      }
      return { data: [], error: null }
    })

    const result = await estimateQueryCost({
      sql: 'SELECT 1',
      hostId: 0,
    })

    expect(result).toEqual({
      estRows: 0,
      estBytesRead: 0,
      estPeakMemoryBytes: 0,
      estWallMs: 0,
      confidence: 'low',
      warnings: expect.arrayContaining([
        expect.stringContaining('Could not parse'),
      ]),
    })
  })
})
