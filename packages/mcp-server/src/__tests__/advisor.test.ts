import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const calls: Array<{ query: string; hostId?: number }> = []

/**
 * How many times the batched schema statement (#3640, #3642) was answered by
 * the fixture. The column and skip-index coverage below is worthless without
 * it — the partition-key and PREWHERE scorers produce recommendations on their
 * own, so a batched payload that silently degraded to "no columns" used to
 * leave every test green (issue #3655).
 */
let batchedSchemaHits = 0

/**
 * `fetchTableSchema` reads `system.tables` + `system.columns` +
 * `system.data_skipping_*` in ONE statement, so the three sources appear
 * together and the single-table branches below all match it. Recognise the
 * batched statement on that combination, ahead of them, rather than relying on
 * branch order.
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
 * Batched schema row, reusing the payload of `__tests__/table-schema-batch.test.ts`
 * (same table, same keys, same columns/indexes) with three rows added so the
 * assertions below have something the scorers can only get from the decoded
 * arrays:
 *   - `created_at` (DateTime, outside the partition key) — partition-key scoring
 *   - `payload` (large, unindexed, outside the sorting key) — skip-index scoring
 *   - `region` (small, already indexed, outside the sorting key) — an existing
 *     index must SUPPRESS the recommendation `payload` gets
 *
 * `columns` and `skip_indexes` are `Array(Tuple)` values, so JSONEachRow hands
 * them over as arrays of arrays in the SQL's field order
 * (position, name, type, is_in_partition_key, is_in_sorting_key,
 * data_compressed_bytes, data_uncompressed_bytes) and
 * (name, type, expression, granularity). The order is load-bearing: the decoder
 * reads positionally, so a scrambled tuple silently pairs every column with the
 * wrong name/type/bytes instead of failing.
 */
const BATCHED_SCHEMA_ROW = {
  partition_key: 'toYYYYMM(event_date)',
  sorting_key: '`user_id`, status',
  columns: [
    [0, 'event_date', 'Date', 1, 0, 100, '400'],
    [1, 'user_id', 'UInt64', '0', 1, 200, 800],
    [2, 'status', 'LowCardinality(String)', 0, '1', '300', 900],
    [3, 'created_at', 'DateTime', 0, 0, 1_500, 3_000],
    [4, 'payload', 'String', 0, 0, 100_000, 200_000],
    [5, 'region', 'String', 0, 0, 20, 40],
  ],
  skip_indexes: [
    ['idx_status', 'set(0)', 'status', '4'],
    ['idx_user', 'bloom_filter', 'user_id', 1],
    ['idx_region', 'minmax', 'region', 4],
  ],
}

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
    return {
      data: [
        { partition_key: 'event_date', sorting_key: 'event_date, user_id' },
      ],
      error: null,
    }
  }
  if (q.includes('system.columns')) {
    return {
      data: [
        {
          name: 'status',
          type: 'String',
          is_in_partition_key: 0,
          is_in_sorting_key: 0,
          data_compressed_bytes: 1000,
          data_uncompressed_bytes: 2000,
        },
      ],
      error: null,
    }
  }
  if (q.includes('system.data_skipping_indices'))
    return { data: [], error: null }
  if (q.includes('system.parts')) {
    return {
      data: [
        {
          active_parts: 5,
          total_rows: 1000,
          total_bytes: 100000,
          total_granules: 1000,
        },
      ],
      error: null,
    }
  }
  if (q.includes('explain plan indexes')) {
    return {
      data: [
        { explain: 'PrimaryKey' },
        { explain: 'Parts: 5/5' },
        { explain: 'Granules: 900/1000' },
      ],
      error: null,
    }
  }
  if (q.includes('explain estimate'))
    return { data: [{ marks: 900 }], error: null }
  return { data: [], error: null }
}

const mockFetchData = mock(
  async (params: { query: string; hostId?: number }) => {
    calls.push({ query: params.query, hostId: params.hostId })
    return respond(params.query)
  }
)

mock.module('@chm/clickhouse-client', () => ({ fetchData: mockFetchData }))

const { registerAdvisorTool } = await import('../tools/advisor')
const { McpServer } = await import('@modelcontextprotocol/server')

function getToolHandler(server: InstanceType<typeof McpServer>, name: string) {
  const tools = (server as any)._registeredTools
  const tool = tools?.[name]
  if (!tool?.handler) throw new Error(`Tool "${name}" not found`)
  return (args: Record<string, unknown>) => tool.handler(args, {})
}

describe('registerAdvisorTool', () => {
  test('registers without errors', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    expect(() => registerAdvisorTool(server)).not.toThrow()
  })

  test('returns ranked recommendations for a raw sql query', async () => {
    calls.length = 0
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerAdvisorTool(server)
    const call = getToolHandler(server, 'get_optimization_recommendations')

    const result = await call({
      sql: "SELECT * FROM default.events WHERE status = 'error'",
    })
    const body = JSON.parse(result.content[0].text)

    expect(body.ok).toBe(true)
    expect(Array.isArray(body.recommendations)).toBe(true)
    expect(body.recommendations.length).toBeGreaterThan(0)
  })

  test('resolves a query_id via system.query_log', async () => {
    calls.length = 0
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerAdvisorTool(server)
    const call = getToolHandler(server, 'get_optimization_recommendations')

    const result = await call({ queryId: 'abc' })
    const body = JSON.parse(result.content[0].text)
    expect(body.ok).toBe(true)
  })

  test('returns an error result when neither sql nor queryId is given', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerAdvisorTool(server)
    const call = getToolHandler(server, 'get_optimization_recommendations')

    const result = await call({})
    expect(result.isError).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Coverage guards for the batched schema read (#3640, #3642). Before this
  // fixture knew the single batched statement, the `system.tables` branch
  // matched it first and answered `{ partition_key, sorting_key }` only —
  // `columns` and `skip_indexes` never reached the engine, and every test in
  // this file stayed green because the PREWHERE scorer alone produces a
  // recommendation (issue #3655). Each assertion below is pinned to data that
  // exists only in the batched `columns` / `skip_indexes` arrays.
  // -------------------------------------------------------------------------

  async function analyze(sql: string) {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerAdvisorTool(server)
    const call = getToolHandler(server, 'get_optimization_recommendations')
    const result = await call({ sql })
    expect(result.isError).toBeFalsy()
    return JSON.parse(result.content[0].text)
  }

  test('the schema read is one batched statement, and the fixture answers it', async () => {
    calls.length = 0
    batchedSchemaHits = 0
    await analyze("SELECT * FROM default.events WHERE status = 'error'")

    expect(batchedSchemaHits).toBe(1)
    const schemaReads = calls.filter((c) =>
      c.query.toLowerCase().includes('system.data_skipping_ind')
    )
    expect(schemaReads).toHaveLength(1)
  })

  test('a range predicate on an unpartitioned DateTime column is scored from the batched columns', async () => {
    batchedSchemaHits = 0
    const body = await analyze(
      'SELECT * FROM default.events WHERE created_at > now() - INTERVAL 7 DAY'
    )

    expect(batchedSchemaHits).toBe(1)
    // `created_at` exists only in the batched `columns` array, and its `type`
    // field only decodes correctly from the right tuple position.
    const partitionKey = body.recommendations.find(
      (r: { kind: string }) => r.kind === 'partition_key'
    )
    expect(partitionKey).toBeDefined()
    expect(partitionKey.ddl).toContain('created_at')
  })

  test('existing skip indexes from the batched row suppress their own recommendation', async () => {
    batchedSchemaHits = 0
    const body = await analyze(
      "SELECT * FROM default.events WHERE payload = 'raw' AND region = 'eu'"
    )

    expect(batchedSchemaHits).toBe(1)
    const skipIndexes = body.recommendations.filter(
      (r: { kind: string }) => r.kind === 'skip_index'
    )
    const ddl = skipIndexes.map((r: { ddl: string }) => r.ddl).join('\n')
    // `payload` is unindexed and outside the sorting key; `region` already has
    // `idx_region` in the batched row, so it must get nothing.
    expect(ddl).toContain('payload')
    expect(ddl).not.toContain('region')
  })

  test('the PREWHERE candidate is picked from the batched column byte sizes', async () => {
    batchedSchemaHits = 0
    const body = await analyze(
      "SELECT * FROM default.events WHERE payload = 'raw' AND region = 'eu'"
    )

    expect(batchedSchemaHits).toBe(1)
    const prewhere = body.recommendations.find(
      (r: { kind: string }) => r.kind === 'prewhere'
    )
    expect(prewhere).toBeDefined()
    // `region` is the cheap column by compressed size; with no column data the
    // average is 0, every column looks cheap, and `payload` wins instead.
    expect(prewhere.rewrittenSql).toContain('PREWHERE region')
  })

  test('recommend-only: every query issued is read-only, and the file has no execute/write surface', async () => {
    calls.length = 0
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerAdvisorTool(server)
    const call = getToolHandler(server, 'get_optimization_recommendations')
    await call({ sql: "SELECT * FROM default.events WHERE status = 'error'" })

    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) {
      const trimmed = c.query.trim().toUpperCase()
      expect(trimmed).toMatch(/^(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE)\b/)
      expect(
        /\b(ALTER|CREATE|INSERT|DROP|TRUNCATE|RENAME|DELETE|UPDATE)\b/i.test(
          c.query
        )
      ).toBe(false)
    }

    // The pure engine now lives in @chm/query-advisor-core, which carries its
    // own recommend-only guard (src/recommend-only.test.ts). What is left here
    // is the MCP orchestration + I/O layer.
    const advisorDir = join(import.meta.dir, '..', 'tools', 'advisor')
    const files = ['index.ts', 'data-fetchers.ts']
    for (const file of files) {
      const source = readFileSync(join(advisorDir, file), 'utf-8')
      expect(source).not.toMatch(/\.command\s*\(/)
      expect(source).not.toMatch(/\.insert\s*\(/)
    }
  })
})
