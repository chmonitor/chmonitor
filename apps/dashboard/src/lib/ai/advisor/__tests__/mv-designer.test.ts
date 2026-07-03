// @ts-nocheck — test file, only runs under bun:test
import { describe, expect, mock, test } from 'bun:test'

// bun test runs with --isolate (see apps/dashboard/package.json), so
// mock.module() here is scoped to this file's process — mirrors
// capacity-forecaster.test.ts.
const sentQueries: Array<{
  query: string
  query_params: Record<string, unknown>
}> = []
const mockFetchData = mock(async (_params: any) => ({
  data: [] as any[],
  error: null,
})) as any
mock.module('@chm/clickhouse-client', () => ({ fetchData: mockFetchData }))

const {
  splitTopLevelCommas,
  extractGroupByKeys,
  extractAggregateCalls,
  groupByMatchesSortingPrefix,
  chooseDesign,
  buildDdl,
  buildRiskNote,
  estimateMvSize,
  scaleCardinality,
  estimateImpact,
  designMaterializedViews,
} = await import('../mv-designer')

describe('splitTopLevelCommas', () => {
  test('splits a plain column list', () => {
    expect(splitTopLevelCommas('a, b, c')).toEqual(['a', 'b', 'c'])
  })

  test('does not split commas nested inside function-call parens', () => {
    expect(splitTopLevelCommas('toDate(event_time), user_id')).toEqual([
      'toDate(event_time)',
      'user_id',
    ])
  })

  test('empty input yields no parts', () => {
    expect(splitTopLevelCommas('')).toEqual([])
    expect(splitTopLevelCommas('   ')).toEqual([])
  })
})

describe('extractGroupByKeys', () => {
  test('extracts a simple GROUP BY list', () => {
    expect(
      extractGroupByKeys('SELECT status, count() FROM t GROUP BY status')
    ).toEqual(['status'])
  })

  test('extracts multiple keys and stops at ORDER BY', () => {
    expect(
      extractGroupByKeys(
        'SELECT a, b, sum(c) FROM t GROUP BY a, b ORDER BY a DESC LIMIT 10'
      )
    ).toEqual(['a', 'b'])
  })

  test('stops at HAVING and LIMIT when ORDER BY is absent', () => {
    expect(
      extractGroupByKeys(
        'SELECT a, count() FROM t GROUP BY a HAVING count() > 1'
      )
    ).toEqual(['a'])
    expect(
      extractGroupByKeys('SELECT a, count() FROM t GROUP BY a LIMIT 5')
    ).toEqual(['a'])
  })

  test('no GROUP BY yields an empty list', () => {
    expect(extractGroupByKeys('SELECT * FROM t')).toEqual([])
  })

  test('exotic forms (GROUP BY ALL / GROUPING SETS) are not modeled — empty list, not a guess', () => {
    expect(extractGroupByKeys('SELECT a, b FROM t GROUP BY ALL')).toEqual([])
    expect(
      extractGroupByKeys('SELECT a, b FROM t GROUP BY GROUPING SETS ((a), (b))')
    ).toEqual([])
  })
})

describe('extractAggregateCalls', () => {
  test('sum/count-only shape', () => {
    const calls = extractAggregateCalls(
      'SELECT status, sum(amount) AS total, count() AS cnt FROM t GROUP BY status'
    )
    expect(calls).toEqual([
      { func: 'sum', arg: 'amount' },
      { func: 'count', arg: '' },
    ])
  })

  test('mixed-aggregate shape (avg, uniq)', () => {
    const calls = extractAggregateCalls(
      'SELECT user_id, avg(duration) AS d, uniq(session_id) AS s FROM t GROUP BY user_id'
    )
    expect(calls).toEqual([
      { func: 'avg', arg: 'duration' },
      { func: 'uniq', arg: 'session_id' },
    ])
  })

  test('no aggregate functions yields an empty list', () => {
    expect(extractAggregateCalls('SELECT a, b FROM t')).toEqual([])
  })
})

describe('groupByMatchesSortingPrefix', () => {
  test('matches when GROUP BY keys equal the sorting key prefix (order-insensitive)', () => {
    expect(
      groupByMatchesSortingPrefix(['day', 'host'], ['day', 'host', 'metric'])
    ).toBe(true)
    expect(
      groupByMatchesSortingPrefix(['host', 'day'], ['day', 'host', 'metric'])
    ).toBe(true)
  })

  test('does not match when the sorting key prefix differs', () => {
    expect(groupByMatchesSortingPrefix(['status'], ['event_date'])).toBe(false)
  })

  test('does not match when the sorting key is shorter than the GROUP BY keys', () => {
    expect(groupByMatchesSortingPrefix(['a', 'b'], ['a'])).toBe(false)
  })

  test('empty GROUP BY keys never match', () => {
    expect(groupByMatchesSortingPrefix([], ['a', 'b'])).toBe(false)
  })
})

describe('chooseDesign', () => {
  // Fixtures deliberately isolate each branch: the projection check runs
  // first, so the Summing/Aggregating fixtures use a sorting key that does
  // NOT match their GROUP BY keys (otherwise a sum/count-only shape that
  // also happened to match the sort prefix would return a projection, not
  // SummingMergeTree, masking the assertion).
  test('sum/count-only + sorting key does not match GROUP BY -> SummingMergeTree', () => {
    const design = chooseDesign({
      tableCount: 1,
      groupByKeys: ['status'],
      sortingKeyCols: ['event_date'],
      aggregateCalls: [
        { func: 'sum', arg: 'amount' },
        { func: 'count', arg: '' },
      ],
    })
    expect(design.kind).toBe('summing_mv')
    expect(design.rationale).toContain('SummingMergeTree')
  })

  test('mixed aggregates + sorting key does not match GROUP BY -> AggregatingMergeTree', () => {
    const design = chooseDesign({
      tableCount: 1,
      groupByKeys: ['user_id'],
      sortingKeyCols: ['event_date'],
      aggregateCalls: [
        { func: 'avg', arg: 'duration' },
        { func: 'uniq', arg: 'session_id' },
      ],
    })
    expect(design.kind).toBe('aggregating_mv')
    expect(design.rationale).toContain('AggregatingMergeTree')
    expect(design.rationale).toContain('-State')
    expect(design.rationale).toContain('-Merge')
  })

  test('single-table + GROUP BY matches sorting-key prefix -> projection, even for a sum-only shape', () => {
    const design = chooseDesign({
      tableCount: 1,
      groupByKeys: ['day'],
      sortingKeyCols: ['day', 'host'],
      aggregateCalls: [{ func: 'sum', arg: 'value' }],
    })
    expect(design.kind).toBe('projection')
    expect(design.rationale).toContain('PROJECTION')
    expect(design.rationale.toLowerCase()).toContain('read-mostly')
  })

  test('multi-table (JOIN) shapes never get a projection, even if keys would otherwise match', () => {
    const design = chooseDesign({
      tableCount: 2,
      groupByKeys: ['day'],
      sortingKeyCols: ['day', 'host'],
      aggregateCalls: [{ func: 'sum', arg: 'value' }],
    })
    expect(design.kind).not.toBe('projection')
    expect(design.kind).toBe('summing_mv')
  })
})

describe('buildDdl', () => {
  test('SummingMergeTree DDL for a sum/count-only shape', () => {
    const ddl = buildDdl({
      design: { kind: 'summing_mv', rationale: '' },
      database: 'analytics',
      table: 'orders',
      groupByKeys: ['status'],
      aggregateCalls: [
        { func: 'sum', arg: 'amount' },
        { func: 'count', arg: '' },
      ],
    })
    expect(ddl).toContain('CREATE MATERIALIZED VIEW')
    expect(ddl).toContain('ENGINE = SummingMergeTree()')
    expect(ddl).toContain('ORDER BY (status)')
    expect(ddl).toContain('sum(amount)')
    expect(ddl).toContain('count()')
    expect(ddl).toContain('GROUP BY status')
    expect(ddl).not.toContain('State(')
  })

  test('AggregatingMergeTree DDL uses -State columns', () => {
    const ddl = buildDdl({
      design: { kind: 'aggregating_mv', rationale: '' },
      database: 'analytics',
      table: 'events',
      groupByKeys: ['user_id'],
      aggregateCalls: [
        { func: 'avg', arg: 'duration' },
        { func: 'uniq', arg: 'session_id' },
      ],
    })
    expect(ddl).toContain('ENGINE = AggregatingMergeTree()')
    expect(ddl).toContain('avgState(duration)')
    expect(ddl).toContain('uniqState(session_id)')
  })

  test('projection DDL is an ALTER TABLE ADD PROJECTION, not a CREATE MATERIALIZED VIEW', () => {
    const ddl = buildDdl({
      design: { kind: 'projection', rationale: '' },
      database: 'analytics',
      table: 'metrics',
      groupByKeys: ['day'],
      aggregateCalls: [{ func: 'sum', arg: 'value' }],
    })
    expect(ddl).toContain('ALTER TABLE')
    expect(ddl).toContain('ADD PROJECTION')
    expect(ddl).toContain('GROUP BY day')
    expect(ddl).not.toContain('CREATE MATERIALIZED VIEW')
  })
})

describe('buildRiskNote', () => {
  test('every engine states the write-path/storage trade-off — never hidden', () => {
    for (const kind of [
      'projection',
      'summing_mv',
      'aggregating_mv',
    ] as const) {
      const note = buildRiskNote(kind)
      expect(note.toLowerCase()).toContain('write-path')
      expect(note.toLowerCase()).toContain('storage')
    }
  })

  test('AggregatingMergeTree risk note names the -State/-Merge requirement', () => {
    expect(buildRiskNote('aggregating_mv')).toContain('-Merge')
  })

  test('projection risk note names the rebuild-on-ALTER cost', () => {
    const note = buildRiskNote('projection')
    expect(note).toContain('MATERIALIZE PROJECTION')
  })
})

describe('estimateMvSize', () => {
  test('estimated bytes is sourceBytes * (distinct / rows), within 10% (exact here by construction)', () => {
    const result = estimateMvSize({
      sourceRows: 1_000_000,
      sourceBytes: 1_000_000_000,
      distinctCombinations: 50_000,
    })
    const expectedBytes = 1_000_000_000 * (50_000 / 1_000_000)
    expect(
      Math.abs(result.estimatedBytes - expectedBytes) / expectedBytes
    ).toBeLessThan(0.1)
    expect(result.estimatedRows).toBe(50_000)
    expect(result.aggregationRatio).toBeCloseTo(0.05, 6)
    expect(result.label).toBe('estimate')
  })

  test('ratio is clamped to at most 1 (distinct count can not exceed rows in a sane world)', () => {
    const result = estimateMvSize({
      sourceRows: 100,
      sourceBytes: 1000,
      distinctCombinations: 500, // pathological input
    })
    expect(result.aggregationRatio).toBe(1)
    expect(result.estimatedBytes).toBe(1000)
  })

  test('zero source rows degrades to a zero ratio rather than dividing by zero', () => {
    const result = estimateMvSize({
      sourceRows: 0,
      sourceBytes: 0,
      distinctCombinations: 0,
    })
    expect(result.aggregationRatio).toBe(0)
    expect(result.estimatedBytes).toBe(0)
  })
})

describe('scaleCardinality', () => {
  test('passes through unscaled when the sample already covers the whole table', () => {
    expect(scaleCardinality(400, 100_000, 50_000)).toBe(400) // sample already covers all 50k rows
    expect(scaleCardinality(400, 100_000, 100_000)).toBe(400)
  })

  test('scales linearly by the inverse sampling fraction', () => {
    // 10% sample (100k of 1M rows) saw 4 distinct combos -> scaled to 40.
    expect(scaleCardinality(4, 100_000, 1_000_000)).toBe(40)
  })

  test('never exceeds sourceRows, even for a pathological sample', () => {
    expect(scaleCardinality(100_000, 100_000, 1_000_000)).toBeLessThanOrEqual(
      1_000_000
    )
  })

  test('degenerate inputs (zero sample or source) return 0, never NaN/throw', () => {
    expect(scaleCardinality(10, 0, 1000)).toBe(0)
    expect(scaleCardinality(10, 1000, 0)).toBe(0)
  })
})

describe('estimateImpact', () => {
  test('bytes saved is the per-call reduction times calls in the window', () => {
    const impact = estimateImpact({
      callsInWindow: 100,
      totalReadBytes: 100 * 1_000_000, // 1MB/call today
      mvEstimatedBytes: 100_000, // MV would be 100KB total
    })
    expect(impact.callsInWindow).toBe(100)
    expect(impact.currentReadBytesTotal).toBe(100_000_000)
    expect(impact.estimatedBytesSavedTotal).toBe(
      Math.round((1_000_000 - 100_000) * 100)
    )
    expect(impact.label).toBe('estimate')
  })

  test('never reports negative savings when the MV would be larger than current per-call reads', () => {
    const impact = estimateImpact({
      callsInWindow: 10,
      totalReadBytes: 10 * 100, // 100 bytes/call
      mvEstimatedBytes: 1_000_000, // absurdly large MV relative to a tiny query
    })
    expect(impact.estimatedBytesSavedTotal).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Orchestration — mocked fetchData, mirroring capacity-forecaster.test.ts.
// Three single-table fixtures deliberately exercise all three design kinds
// (see chooseDesign fixture notes above), plus one JOIN shape that must be
// excluded from recommendations while still counting toward shapesAnalyzed.
// ---------------------------------------------------------------------------

const MINED_ROWS = [
  {
    hash: 'h1',
    calls: 500,
    total_read_bytes: 500_000_000,
    sample_query:
      'SELECT status, sum(amount) AS total, count() AS cnt FROM analytics.orders WHERE event_date >= today() - 7 GROUP BY status',
  },
  {
    hash: 'h2',
    calls: 200,
    total_read_bytes: 400_000_000,
    sample_query:
      'SELECT user_id, avg(duration) AS avg_dur, uniq(session_id) AS uniq_sessions FROM analytics.events GROUP BY user_id',
  },
  {
    hash: 'h3',
    calls: 1000,
    total_read_bytes: 100_000_000,
    sample_query:
      'SELECT day, sum(value) AS total_value FROM analytics.metrics GROUP BY day',
  },
  {
    hash: 'h4',
    calls: 50,
    total_read_bytes: 50_000_000,
    sample_query:
      'SELECT a.status, count() AS cnt FROM analytics.orders a JOIN analytics.users u ON a.user_id = u.id GROUP BY a.status',
  },
]

const PARTS_STATS: Record<string, { rows: number; bytes_on_disk: number }> = {
  orders: { rows: 1_000_000, bytes_on_disk: 200_000_000 },
  events: { rows: 500_000, bytes_on_disk: 150_000_000 },
  metrics: { rows: 2_000_000, bytes_on_disk: 300_000_000 },
}

const SORTING_KEYS: Record<string, string> = {
  orders: 'event_date', // does not match GROUP BY key `status` -> summing_mv
  events: 'event_date', // does not match GROUP BY key `user_id` -> aggregating_mv
  metrics: 'day, host', // prefix matches GROUP BY key `day` -> projection
}

const CARDINALITY_SAMPLES: Record<string, number> = {
  orders: 4, // ~4 statuses
  events: 50_000, // high-cardinality users
  metrics: 30, // ~30 distinct days in the sample window
}

function installHappyPathMock() {
  mockFetchData.mockImplementation(async ({ query, query_params }: any) => {
    sentQueries.push({ query, query_params })
    if (query.includes('FROM system.query_log')) {
      return { data: MINED_ROWS, error: null }
    }
    if (query.includes('FROM system.parts')) {
      const stats = PARTS_STATS[query_params.table]
      return { data: stats ? [stats] : [], error: null }
    }
    if (query.includes('FROM system.tables')) {
      const key = SORTING_KEYS[query_params.table]
      return { data: key ? [{ sorting_key: key }] : [], error: null }
    }
    if (query.includes('uniqCombined')) {
      for (const [table, distinct] of Object.entries(CARDINALITY_SAMPLES)) {
        if (query.includes(table)) {
          return { data: [{ distinct_combos: distinct }], error: null }
        }
      }
    }
    return { data: [], error: null }
  })
}

describe('designMaterializedViews', () => {
  test('mines three single-table shapes into the right engine each, excludes the JOIN shape, and clears the 60% coverage bar', async () => {
    sentQueries.length = 0
    installHappyPathMock()

    const result = await designMaterializedViews({ hostId: 0 })

    expect(result.available).toBe(true)
    if (!result.available) return

    // 4 real aggregation shapes mined (join shape counts toward the
    // denominator even though it's excluded from recommendations).
    expect(result.shapesAnalyzed).toBe(4)
    expect(result.shapesWithRecommendation).toBe(3)
    expect(result.coverageRatio).toBeGreaterThanOrEqual(0.6)

    const byTable = Object.fromEntries(
      result.recommendations.map((r) => [r.table, r])
    )
    expect(byTable['`analytics`.`orders`'].kind).toBe('summing_mv')
    expect(byTable['`analytics`.`events`'].kind).toBe('aggregating_mv')
    expect(byTable['`analytics`.`metrics`'].kind).toBe('projection')

    // No recommendation was produced for the JOIN shape's table pairing.
    expect(result.recommendations).toHaveLength(3)
  })

  test('SAFETY: every query sent is read-only, and no DDL is ever executed', async () => {
    sentQueries.length = 0
    installHappyPathMock()

    await designMaterializedViews({ hostId: 0 })

    expect(sentQueries.length).toBeGreaterThan(0)
    for (const { query } of sentQueries) {
      const upper = query.toUpperCase()
      expect(upper.trimStart().startsWith('SELECT')).toBe(true)
      expect(upper).not.toContain('CREATE MATERIALIZED VIEW')
      expect(upper).not.toContain('ADD PROJECTION')
      expect(upper).not.toContain('INSERT ')
      expect(upper).not.toContain('DROP ')
    }
  })

  test('SAFETY: the module exposes no apply/execute/run function — recommendations are inert text', async () => {
    const mod = await import('../mv-designer')
    const dangerous = Object.keys(mod).filter((k) =>
      /^(apply|execute|run|create|alter)/i.test(k)
    )
    expect(dangerous).toEqual([])
  })

  test('each recommendation carries a labeled size estimate, impact, and risk note', async () => {
    sentQueries.length = 0
    installHappyPathMock()

    const result = await designMaterializedViews({ hostId: 0 })
    expect(result.available).toBe(true)
    if (!result.available) return

    for (const rec of result.recommendations) {
      expect(rec.sizeEstimate.label).toBe('estimate')
      expect(rec.impact.label).toBe('estimate')
      expect(typeof rec.risk).toBe('string')
      expect(rec.risk.length).toBeGreaterThan(0)
      expect(typeof rec.ddl).toBe('string')
      expect(rec.ddl.length).toBeGreaterThan(0)
    }
  })

  test('the `table` filter restricts analysis to one table', async () => {
    sentQueries.length = 0
    installHappyPathMock()

    const result = await designMaterializedViews({ hostId: 0, table: 'orders' })
    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].table).toBe('`analytics`.`orders`')
  })

  test('graceful degrade: returns available:false (never a fabricated recommendation) when system.query_log is unreadable', async () => {
    mockFetchData.mockImplementation(async ({ query }: any) => {
      if (query.includes('FROM system.query_log')) {
        throw new Error('Not enough privileges')
      }
      return { data: [], error: null }
    })

    const result = await designMaterializedViews({ hostId: 0 })
    expect(result.available).toBe(false)
    if (result.available) return
    expect(result.reason).toBe('query_log_unavailable')
    expect(result.message.toLowerCase()).toContain('query_log')
  })

  test('graceful degrade: a per-shape failure (e.g. no grant on system.parts for one table) skips only that shape', async () => {
    mockFetchData.mockImplementation(async ({ query, query_params }: any) => {
      if (query.includes('FROM system.query_log')) {
        return { data: MINED_ROWS, error: null }
      }
      if (query.includes('FROM system.parts')) {
        if (query_params.table === 'events') {
          throw new Error('Not enough privileges')
        }
        const stats = PARTS_STATS[query_params.table]
        return { data: stats ? [stats] : [], error: null }
      }
      if (query.includes('FROM system.tables')) {
        const key = SORTING_KEYS[query_params.table]
        return { data: key ? [{ sorting_key: key }] : [], error: null }
      }
      if (query.includes('uniqCombined')) {
        for (const [table, distinct] of Object.entries(CARDINALITY_SAMPLES)) {
          if (query.includes(table)) {
            return { data: [{ distinct_combos: distinct }], error: null }
          }
        }
      }
      return { data: [], error: null }
    })

    const result = await designMaterializedViews({ hostId: 0 })
    expect(result.available).toBe(true)
    if (!result.available) return

    const tables = result.recommendations.map((r) => r.table)
    expect(tables).toContain('`analytics`.`orders`')
    expect(tables).toContain('`analytics`.`metrics`')
    expect(tables).not.toContain('`analytics`.`events`')
    expect(result.shapesAnalyzed).toBe(4) // still counted, just not recommended
  })
})
