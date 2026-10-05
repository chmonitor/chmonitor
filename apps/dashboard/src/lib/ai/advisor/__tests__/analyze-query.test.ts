// @ts-nocheck — test file, only runs under bun:test

import { makeContext, makeSchema } from './fixtures'
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// bun test runs with --isolate (see apps/dashboard/package.json), so this
// mock.module is scoped to this file's process (matches
// capacity-forecaster.test.ts's pattern for the same module).
interface FetchCall {
  query: string
  query_params?: Record<string, unknown>
  clickhouse_settings?: Record<string, unknown>
}
const calls: FetchCall[] = []

let batchedSchemaHits = 0

/**
 * `fetchTableSchema` reads `system.tables` + `system.columns` +
 * `system.data_skipping_*` in ONE statement, so all three sources appear in the
 * same SQL and the single-table branches below all match it. Recognise the
 * batched statement on that combination, ahead of them, rather than relying on
 * branch order (issue #3655).
 */
function isBatchedSchemaQuery(q: string): boolean {
  return (
    q.includes('system.tables') &&
    q.includes('system.columns') &&
    // Bare prefix so the check holds for the shipped identifier and for a
    // corrected one (#3654) without changing what this mock matches today.
    q.includes('system.data_skipping_ind')
  )
}

/**
 * Batched schema row, reusing the payload of
 * `__tests__/table-schema-batch.test.ts` (same keys, same columns/indexes) with
 * three rows added so the assertions in `describe('analyzeQuery — batched
 * schema coverage')` have something the scorers can only get from the decoded
 * arrays:
 *   - `created_at` (DateTime, outside the partition key) — partition-key scoring
 *   - `region` (cheap, unindexed, outside the sorting key) — PREWHERE ranking
 *   - `payload` (large, indexed, outside the sorting key) — an existing skip
 *     index must SUPPRESS the recommendation `region` gets
 *
 * `columns` and `skip_indexes` are `Array(Tuple)` values, so JSONEachRow hands
 * them over as arrays of arrays in the SQL's field order
 * (position, name, type, is_in_partition_key, is_in_sorting_key,
 * data_compressed_bytes, data_uncompressed_bytes) and
 * (name, type, expression, granularity). `tupleAt(...)` reads them by index, so
 * a scrambled order pairs every column with the wrong name/type/bytes instead of
 * failing.
 */
const BATCHED_SCHEMA_ROW = {
  partition_key: 'toYYYYMM(event_date)',
  sorting_key: '`event_date`, user_id',
  columns: [
    [1, 'event_date', 'Date', 1, 1, '500', 1000],
    [2, 'user_id', 'UInt64', 0, '1', 1000, '2000'],
    [3, 'payload', 'String', 0, 0, 50_000_000, 80_000_000],
    [4, 'created_at', 'DateTime', 0, 0, 1_500, 3_000],
    [5, 'region', 'String', 0, 0, 20, 40],
  ],
  skip_indexes: [
    ['idx_user', 'bloom_filter', 'user_id', '4'],
    ['idx_payload', 'minmax', 'payload', 1],
  ],
}

/** Query-aware fixture responder — dispatches on substrings in the SQL text. */
function respond(query: string): { data: unknown[]; error: null } {
  const q = query.toLowerCase()
  if (q.includes('system.query_log')) {
    return {
      data: [{ query: "SELECT * FROM default.events WHERE status = 'error'" }],
      error: null,
    }
  }
  if (isBatchedSchemaQuery(q)) {
    batchedSchemaHits += 1
    return { data: [BATCHED_SCHEMA_ROW], error: null }
  }
  if (q.includes('system.tables')) {
    if (q.includes('engine_full') || q.includes('engine,')) {
      return {
        data: [{ engine: 'MergeTree', engine_full: 'MergeTree' }],
        error: null,
      }
    }
    return {
      data: [
        { partition_key: 'event_date', sorting_key: 'event_date, user_id' },
      ],
      error: null,
    }
  }
  if (q.includes('system.clusters')) {
    return { data: [], error: null }
  }
  if (q.includes('system.columns')) {
    return {
      data: [
        {
          name: 'event_date',
          type: 'Date',
          is_in_partition_key: 1,
          is_in_sorting_key: 1,
          data_compressed_bytes: 500_000,
          data_uncompressed_bytes: 1_000_000,
        },
        {
          name: 'user_id',
          type: 'UInt64',
          is_in_partition_key: 0,
          is_in_sorting_key: 1,
          data_compressed_bytes: 1_000_000,
          data_uncompressed_bytes: 2_000_000,
        },
        {
          name: 'status',
          type: 'String',
          is_in_partition_key: 0,
          is_in_sorting_key: 0,
          data_compressed_bytes: 2_000_000,
          data_uncompressed_bytes: 4_000_000,
        },
      ],
      error: null,
    }
  }
  if (q.includes('system.data_skipping_indexes')) {
    return { data: [], error: null }
  }
  if (q.includes('system.parts')) {
    return {
      data: [
        {
          active_parts: 20,
          total_rows: 10_000_000,
          total_bytes: 100_000_000,
          total_granules: 10_000,
        },
      ],
      error: null,
    }
  }
  if (q.includes('explain plan indexes')) {
    return {
      data: [
        { explain: 'ReadFromMergeTree (default.events)' },
        { explain: 'Indexes:' },
        { explain: 'PrimaryKey' },
        { explain: 'Parts: 20/20' },
        { explain: 'Granules: 9000/10000' },
      ],
      error: null,
    }
  }
  if (q.includes('explain estimate')) {
    return { data: [{ marks: 9000 }], error: null }
  }
  throw new Error(`Unmocked query in test: ${query}`)
}

const mockFetchData = mock(
  async (params: {
    query: string
    hostId?: number
    clickhouse_settings?: unknown
    query_params?: unknown
  }) => {
    calls.push({
      query: params.query,
      query_params: params.query_params as Record<string, unknown> | undefined,
      clickhouse_settings: params.clickhouse_settings as
        | Record<string, unknown>
        | undefined,
    })
    return respond(params.query)
  }
) as any
mock.module('@chm/clickhouse-client', () => ({ fetchData: mockFetchData }))
mock.module('@chm/sql-builder', () => ({
  validateSqlQuery: () => {
    // permissive by default — real validation is exercised in sql-builder's own tests
  },
}))
mock.module('@/lib/utils', () => ({
  formatBytes: (bytes: number) => `${bytes}B`,
}))

const {
  analyzeQuery,
  scoreSkipIndex,
  scoreProjection,
  scorePartitionKey,
  proposePrewhereRewrite,
} = await import('../recommendation-engine')

function deepAssertNoFunctions(value: unknown, path = 'root') {
  if (typeof value === 'function') {
    throw new Error(
      `Found a function at ${path} — recommendations must be inert data`
    )
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => deepAssertNoFunctions(v, `${path}[${i}]`))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      deepAssertNoFunctions(v, `${path}.${k}`)
    }
  }
}

describe('analyzeQuery — recommend-only invariant (load-bearing)', () => {
  test('analyzing a query never issues anything but read-only statements, and never touches write paths', async () => {
    calls.length = 0
    const result = await analyzeQuery({
      hostId: 0,
      sql: "SELECT * FROM default.events WHERE status = 'error'",
    })

    expect(result.ok).toBe(true)
    expect(calls.length).toBeGreaterThan(0)

    for (const call of calls) {
      const trimmed = call.query.trim().toUpperCase()
      expect(trimmed).toMatch(/^(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE)\b/)
      // readOnlyQuery (the only helper this module calls) always forces this.
      expect(call.clickhouse_settings).toEqual({ readonly: '1' })
    }
  })

  test('the returned recommendations are inert data — no callables anywhere in the result', async () => {
    const result = await analyzeQuery({
      hostId: 0,
      sql: "SELECT status, count() FROM default.events WHERE status = 'error' GROUP BY status",
    })
    expect(result.ok).toBe(true)
    deepAssertNoFunctions(result)
    // Round-trips through JSON with no loss — proves it's plain serializable data.
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  test('the engine source files expose no execute/apply surface and never import write helpers', () => {
    const dir = join(import.meta.dir, '..')
    for (const file of [
      'recommendation-engine.ts',
      'impact-estimator.ts',
      'query-context.ts',
    ]) {
      const source = readFileSync(join(dir, file), 'utf-8')
      expect(source).not.toMatch(/\bwriteQuery\b/)
      expect(source).not.toMatch(/\.command\s*\(/)
      expect(source).not.toMatch(/\.insert\s*\(/)
      expect(source).not.toMatch(/\bapplyRecommendation\b/)
      expect(source).not.toMatch(/\bexecuteDdl\b/)
    }
  })

  test('never calls fetchData without going through the readonly helper (no bare ALTER/CREATE/INSERT/DROP query text)', async () => {
    calls.length = 0
    await analyzeQuery({
      hostId: 0,
      sql: "SELECT * FROM default.events WHERE status = 'error'",
    })
    const forbidden =
      /\b(ALTER|CREATE|INSERT|DROP|TRUNCATE|RENAME|DELETE|UPDATE)\b/i
    for (const call of calls) {
      expect(forbidden.test(call.query)).toBe(false)
    }
  })
})

describe('analyzeQuery — orchestration', () => {
  test('resolves SQL from a query_id via system.query_log', async () => {
    const result = await analyzeQuery({ hostId: 0, queryId: 'abc-123' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.sql).toContain('status')
    }
  })

  test('returns a clear error when neither sql nor queryId is given', async () => {
    const result = await analyzeQuery({ hostId: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('missing_input')
      expect(result.error).toContain('sql')
    }
  })

  test('SELECT 1 is a no_target_table error and does not look up schema', async () => {
    calls.length = 0
    const result = await analyzeQuery({ hostId: 0, sql: 'select 1' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('no_target_table')
      expect(result.error).toContain('FROM')
    }
    expect(calls).toHaveLength(0)
  })

  test('degrades gracefully (still ok) when EXPLAIN fails, with a note explaining reduced precision', async () => {
    let explainHit = false
    mockFetchData.mockImplementation(async (params: { query: string }) => {
      calls.push({ query: params.query })
      if (params.query.toLowerCase().includes('explain plan indexes')) {
        explainHit = true
        throw new Error('permission denied')
      }
      return respond(params.query)
    })

    const result = await analyzeQuery({
      hostId: 0,
      sql: "SELECT * FROM default.events WHERE status = 'error'",
    })

    expect(explainHit).toBe(true)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.notes.some((n) => n.includes('EXPLAIN'))).toBe(true)
    }

    // restore default responder for subsequent tests
    mockFetchData.mockImplementation(async (params: { query: string }) => {
      calls.push({ query: params.query })
      return respond(params.query)
    })
  })

  test('notes when a query references more than one table and only analyzes the first', async () => {
    mockFetchData.mockImplementation(async (params: { query: string }) => {
      calls.push({ query: params.query })
      return respond(params.query)
    })
    const result = await analyzeQuery({
      hostId: 0,
      sql: "SELECT * FROM default.events e JOIN default.users u ON e.user_id = u.id WHERE e.status = 'error'",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.notes.some((n) => n.includes('events'))).toBe(true)
    }
  })
})

// -------------------------------------------------------------------------
// Coverage guards for the batched schema read (#3640, #3642). Before this
// fixture knew the single batched statement, the `system.tables` branch matched
// it first and answered `{ partition_key, sorting_key }` only — `columns` and
// `skip_indexes` never reached the engine, and every test in this file stayed
// green because the PREWHERE scorer alone produces a recommendation (issue
// #3655). Each assertion below is pinned to data that exists only in the
// batched `columns` / `skip_indexes` arrays.
// -------------------------------------------------------------------------
describe('analyzeQuery — batched schema coverage', () => {
  async function analyze(sql: string) {
    batchedSchemaHits = 0
    calls.length = 0
    const result = await analyzeQuery({ hostId: 0, sql })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(batchedSchemaHits).toBe(1)
    // The whole schema still costs exactly one statement.
    expect(
      calls.filter((c) =>
        c.query.toLowerCase().includes('system.data_skipping_ind')
      )
    ).toHaveLength(1)
    return result.recommendations
  }

  test('a range predicate on an unpartitioned DateTime column is scored from the batched columns', async () => {
    const recs = await analyze(
      'SELECT * FROM default.events WHERE created_at > now() - INTERVAL 7 DAY'
    )
    // `created_at` exists only in the batched `columns` array, and its `type`
    // only decodes correctly from the right tuple position.
    const partitionKey = recs.find((r) => r.kind === 'partition_key')
    expect(partitionKey).toBeDefined()
    expect(partitionKey.ddl).toContain('created_at')
  })

  test('existing skip indexes from the batched row suppress their own recommendation', async () => {
    const recs = await analyze(
      "SELECT * FROM default.events WHERE payload = 'raw' AND region = 'eu'"
    )
    const ddl = recs
      .filter((r) => r.kind === 'skip_index')
      .map((r) => r.ddl)
      .join('\n')
    // `region` is unindexed and outside the sorting key; `payload` already has
    // `idx_payload` in the batched row, so it must get nothing.
    expect(ddl).toContain('region')
    expect(ddl).not.toContain('payload')
  })

  test('the PREWHERE candidate is picked from the batched column byte sizes', async () => {
    const recs = await analyze(
      "SELECT * FROM default.events WHERE payload = 'raw' AND region = 'eu'"
    )
    const prewhere = recs.find((r) => r.kind === 'prewhere')
    expect(prewhere).toBeDefined()
    // `region` is the cheap column by compressed size; with no column data the
    // average is 0, every column looks cheap, and `payload` wins instead.
    expect(prewhere.rewrittenSql).toContain('PREWHERE region')
  })
})

describe('coverage — at least 70% of a realistic fixture set produce >=1 recommendation', () => {
  test('4 of 5 varied query contexts yield a recommendation; the fully-optimized one correctly yields none', () => {
    const countRecs = (ctx: ReturnType<typeof makeContext>) => {
      const recs = [
        ...scoreSkipIndex(ctx),
        ...(scoreProjection(ctx) ? [scoreProjection(ctx)] : []),
        ...(scorePartitionKey(ctx) ? [scorePartitionKey(ctx)] : []),
        ...(!ctx.hasPrewhere && proposePrewhereRewrite(ctx) ? [1] : []),
      ]
      return recs.length
    }

    const scenarios = [
      // (a) selective predicate not in sorting key -> skip_index (+ prewhere)
      makeContext({
        predicates: [
          {
            column: 'status',
            operator: '=',
            isRange: false,
            isEqualityOrIn: true,
          },
        ],
      }),
      // (b) GROUP BY mismatch -> projection
      makeContext({
        predicates: [],
        groupByColumns: ['status'],
        schema: makeSchema({ sortingKeyColumns: ['event_date', 'user_id'] }),
      }),
      // (c) range filter on unpartitioned Date column -> partition_key
      makeContext({
        predicates: [
          {
            column: 'created_at',
            operator: '>',
            isRange: true,
            isEqualityOrIn: false,
          },
        ],
        schema: makeSchema({
          partitionKeyColumns: ['event_date'],
          columns: [
            ...makeSchema().columns,
            {
              name: 'created_at',
              type: 'DateTime',
              isInPartitionKey: false,
              isInSortingKey: false,
              compressedBytes: 1000,
              uncompressedBytes: 2000,
            },
          ],
        }),
      }),
      // (d) selective predicate only -> prewhere rewrite candidate
      makeContext({
        sql: "SELECT * FROM default.events WHERE status = 'error'",
        predicates: [
          {
            column: 'status',
            operator: '=',
            isRange: false,
            isEqualityOrIn: true,
          },
        ],
      }),
      // (e) fully optimized already: predicate on sorting key, GROUP BY matches
      // prefix, no unpartitioned date range, already has PREWHERE -> nothing to suggest
      makeContext({
        sql: 'SELECT event_date, count() FROM default.events PREWHERE event_date = today() GROUP BY event_date',
        predicates: [
          {
            column: 'event_date',
            operator: '=',
            isRange: false,
            isEqualityOrIn: true,
          },
        ],
        groupByColumns: ['event_date'],
        hasPrewhere: true,
        schema: makeSchema({ sortingKeyColumns: ['event_date', 'user_id'] }),
      }),
    ]

    const hits = scenarios.filter((s) => countRecs(s) >= 1).length
    expect(hits).toBe(4)
    expect(hits / scenarios.length).toBeGreaterThanOrEqual(0.7)
  })
})
