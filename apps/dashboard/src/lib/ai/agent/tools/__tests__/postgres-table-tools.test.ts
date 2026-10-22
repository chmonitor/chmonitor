/**
 * Behaviour tests for `get_postgres_table_stats`.
 *
 * We mock `@chm/postgres-client` (the driver boundary) rather than the
 * `../postgres-helpers` module, so the real host resolution, the real
 * `pgHostIdSchema`, and the real error wrapping are all exercised.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))

type QueryCall = { host: string; sql: string; params?: ReadonlyArray<unknown> }

const queryCalls: QueryCall[] = []
const configCalls: number[] = []

const defaultQuery = async (
  config: { host: string },
  sql: string,
  params?: ReadonlyArray<unknown>
): Promise<{ rows: Record<string, unknown>[]; fields: never[] }> => {
  queryCalls.push({ host: config.host, sql, params })
  return { rows: [], fields: [] }
}
const mockQuery = mock(defaultQuery)

mock.module('@chm/postgres-client', () => ({
  getAndValidatePostgresConfig: (id: number) => {
    configCalls.push(id)
    if (id > 1) throw new Error(`Postgres host ${id} is not configured`)
    return { host: `pg-${id}` }
  },
  queryPostgres: mockQuery,
  formatPostgresError: (err: unknown) =>
    `formatted: ${err instanceof Error ? err.message : String(err)}`,
}))

const { createPostgresTableTools } = await import('../postgres-table-tools')

type Tool = {
  inputSchema: unknown
  execute: (input: unknown, opts?: unknown) => Promise<unknown>
}
type Stats = { bloated_tables: unknown[]; unused_indexes: unknown[] }

const tool = () =>
  (createPostgresTableTools() as unknown as Record<string, Tool>)
    .get_postgres_table_stats as Tool
const run = async (input: unknown) => (await tool().execute(input)) as Stats

function parse(input: unknown) {
  const schema = tool().inputSchema as {
    safeParse: (v: unknown) => {
      success: boolean
      data?: { pgHostId: number; limit: number }
    }
  }
  return schema.safeParse(input)
}

const TABLES_ROW = { table_name: 'public.t', n_dead_tup: 5 }
const INDEX_ROW = { table_name: 'public.t', index_name: 't_idx' }

beforeEach(() => {
  queryCalls.length = 0
  configCalls.length = 0
  mockQuery.mockReset()
  mockQuery.mockImplementation(defaultQuery)
})

describe('get_postgres_table_stats input schema', () => {
  test('defaults limit to 10 and coerces a string pgHostId', () => {
    const r = parse({ pgHostId: '1' })
    expect(r.success).toBe(true)
    expect(r.data).toEqual({ pgHostId: 1, limit: 10 })
  })

  test.each([
    ['missing pgHostId', {}],
    ['blank pgHostId', { pgHostId: '  ' }],
    ['negative pgHostId', { pgHostId: -1 }],
    ['zero limit', { pgHostId: 0, limit: 0 }],
    ['limit over 100', { pgHostId: 0, limit: 101 }],
    ['fractional limit', { pgHostId: 0, limit: 2.5 }],
  ])('rejects %s', (_name, input) => {
    expect(parse(input).success).toBe(false)
  })

  test('accepts the limit boundaries 1 and 100', () => {
    expect(parse({ pgHostId: 0, limit: 1 }).success).toBe(true)
    expect(parse({ pgHostId: 0, limit: 100 }).success).toBe(true)
  })
})

describe('get_postgres_table_stats execute', () => {
  test('returns bloated tables and unused indexes from two separate reads', async () => {
    mockQuery.mockImplementation(async (config, sql, params) => {
      queryCalls.push({ host: config.host, sql, params })
      return {
        rows: sql.includes('pg_stat_user_tables') ? [TABLES_ROW] : [INDEX_ROW],
        fields: [],
      }
    })
    const res = await run({ pgHostId: 0, limit: 3 })
    expect(res).toEqual({
      bloated_tables: [TABLES_ROW],
      unused_indexes: [INDEX_ROW],
    })
    expect(queryCalls).toHaveLength(2)
  })

  test('binds limit as $1 for both statements and defaults it to 10', async () => {
    await run({ pgHostId: 0, limit: 7 })
    expect(queryCalls.map((c) => c.params)).toEqual([[7], [7]])
    queryCalls.length = 0
    await run({ pgHostId: 0 })
    expect(queryCalls.map((c) => c.params)).toEqual([[10], [10]])
  })

  test('both statements are single read-only SELECTs with a bound LIMIT', async () => {
    await run({ pgHostId: 0 })
    const sqls = queryCalls.map((c) => c.sql)
    expect(sqls.some((s) => s.includes('pg_stat_user_tables'))).toBe(true)
    expect(sqls.some((s) => s.includes('pg_stat_user_indexes'))).toBe(true)
    for (const sql of sqls) {
      expect(sql.trimStart().startsWith('SELECT')).toBe(true)
      expect(sql).toMatch(/LIMIT \$1$/)
      expect(sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|VACUUM|REINDEX)\b/i
      )
      expect(sql).not.toContain(';')
    }
  })

  test('unused-index query excludes primary-key and unique indexes', async () => {
    await run({ pgHostId: 0 })
    const call = queryCalls.find((c) => c.sql.includes('pg_stat_user_indexes'))
    expect(call).toBeDefined()
    const sql = call?.sql ?? ''
    expect(sql).toContain('idx_scan = 0')
    expect(sql).toContain('NOT i.indisunique')
    expect(sql).toContain('NOT i.indisprimary')
  })

  test('scopes both reads to the requested host', async () => {
    await run({ pgHostId: 1 })
    expect(configCalls).toEqual([1, 1])
    expect(queryCalls.map((c) => c.host)).toEqual(['pg-1', 'pg-1'])
  })

  test('propagates an unconfigured-host error and runs no query', async () => {
    await expect(run({ pgHostId: 5 })).rejects.toThrow(
      'Postgres host 5 is not configured'
    )
    expect(queryCalls).toHaveLength(0)
  })

  test('wraps a driver failure through formatPostgresError', async () => {
    mockQuery.mockImplementation(async () => {
      throw new Error('connection refused')
    })
    await expect(run({ pgHostId: 0 })).rejects.toThrow(
      'formatted: connection refused'
    )
  })

  test('returns empty arrays when nothing is bloated or unused', async () => {
    expect(await run({ pgHostId: 0 })).toEqual({
      bloated_tables: [],
      unused_indexes: [],
    })
  })
})
