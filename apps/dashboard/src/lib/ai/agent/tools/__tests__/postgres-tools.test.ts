/**
 * Unit tests for the agent's Postgres cross-source tools.
 *
 * The read-only SELECT-only gate itself (assertReadOnlyStatement) is exercised
 * against the REAL Phase-2 client in
 * apps/dashboard/src/lib/connection-query/postgres-readonly.test.ts and
 * packages/postgres-client; here we mock the shared `runPostgresReadOnly`
 * helper so these tests stay hermetic and focus on the tools' own behavior:
 * result shaping/truncation, the metrics summary math, and the graceful
 * "extension not installed" branch.
 */

import { z } from 'zod'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// These tools import result helpers from `./helpers`, which pulls
// `@chm/clickhouse-client` (which imports `server-only`) at module load. Mock
// only `server-only` — NOT `@chm/sql-builder` — so this file does not leak an
// incomplete sql-builder mock into other suites (e.g. tool-docs-sync) that need
// the real module. `../postgres-helpers` is mocked so no real Postgres runs.
mock.module('server-only', () => ({}))

const mockRun = mock(
  async (
    _pgHostId: number,
    _sql: string,
    _params?: ReadonlyArray<unknown>
  ): Promise<{ rows: any[]; fields: any[] }> => ({ rows: [], fields: [] })
) as any

mock.module('../postgres-helpers', () => ({
  pgHostIdSchema: z.coerce.number().int().nonnegative(),
  runPostgresReadOnly: mockRun,
}))

const { createPostgresQueryTools } = await import('../postgres-query-tools')
const { createPostgresHealthTools } = await import('../postgres-health-tools')

beforeEach(() => {
  mockRun.mockReset()
  mockRun.mockImplementation(async () => ({ rows: [], fields: [] }))
})

describe('run_postgres_select_query', () => {
  test('returns rows untruncated for a small result', async () => {
    mockRun.mockImplementation(async () => ({
      rows: [{ id: 1 }, { id: 2 }],
      fields: [],
    }))
    const tools = createPostgresQueryTools() as any
    const result = await tools.run_postgres_select_query.execute({
      sql: 'SELECT id FROM t',
      pgHostId: 0,
    })
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }])
    expect(result.truncated).toBe(false)
    expect(result.note).toBeUndefined()
  })

  test('truncates to the requested limit and adds a note', async () => {
    mockRun.mockImplementation(async () => ({
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      fields: [],
    }))
    const tools = createPostgresQueryTools() as any
    const result = await tools.run_postgres_select_query.execute({
      sql: 'SELECT id FROM t',
      pgHostId: 0,
      limit: 2,
    })
    expect(result.data).toHaveLength(2)
    expect(result.truncated).toBe(true)
    expect(result.note).toContain('truncated')
  })

  test('propagates a gate/driver error thrown by the query path', async () => {
    mockRun.mockImplementation(async () => {
      throw new Error(
        'Only read-only statements are allowed (SELECT, WITH, SHOW, EXPLAIN, TABLE, VALUES)'
      )
    })
    const tools = createPostgresQueryTools() as any
    await expect(
      tools.run_postgres_select_query.execute({
        sql: 'INSERT INTO t VALUES (1)',
        pgHostId: 0,
      })
    ).rejects.toThrow(/read-only/)
  })
})

describe('list_postgres_slow_query_patterns', () => {
  test('returns an informative message when pg_stat_statements is missing', async () => {
    mockRun.mockImplementation(async (_id: number, sql: string) => {
      if (sql.includes('pg_extension'))
        return { rows: [{ present: 0 }], fields: [] }
      return { rows: [], fields: [] }
    })
    const tools = createPostgresQueryTools() as any
    const result = await tools.list_postgres_slow_query_patterns.execute({
      pgHostId: 0,
    })
    expect(result.available).toBe(false)
    expect(result.message).toContain('pg_stat_statements')
    // Must NOT have queried the (nonexistent) view.
    const queriedView = mockRun.mock.calls.some((c: any[]) =>
      String(c[1]).includes('FROM pg_stat_statements')
    )
    expect(queriedView).toBe(false)
  })

  test('returns patterns when the extension is present', async () => {
    const patterns = [{ queryid: '1', query: 'SELECT 1', calls: 10 }]
    mockRun.mockImplementation(async (_id: number, sql: string) => {
      if (sql.includes('pg_extension'))
        return { rows: [{ present: 1 }], fields: [] }
      if (sql.includes('FROM pg_stat_statements'))
        return { rows: patterns, fields: [] }
      return { rows: [], fields: [] }
    })
    const tools = createPostgresQueryTools() as any
    const result = await tools.list_postgres_slow_query_patterns.execute({
      pgHostId: 0,
      limit: 5,
    })
    expect(result.available).toBe(true)
    expect(result.patterns).toEqual(patterns)
  })
})

describe('get_postgres_metrics', () => {
  test('assembles version, connections, cache ratio, transactions, and replication', async () => {
    mockRun.mockImplementation(async (_id: number, sql: string) => {
      if (sql.includes('pg_postmaster_start_time')) {
        return {
          rows: [
            {
              version: 'PostgreSQL 17.0',
              uptime_seconds: '3600',
              blks_hit: '900',
              blks_read: '100',
              xact_commit: '50',
              xact_rollback: '2',
              deadlocks: '0',
              db_size_bytes: '1048576',
              db_size: '1024 kB',
              is_replica: false,
              replica_lag_seconds: null,
            },
          ],
          fields: [],
        }
      }
      if (sql.includes('pg_stat_activity')) {
        return {
          rows: [
            { state: 'active', count: 3 },
            { state: 'idle', count: 5 },
          ],
          fields: [],
        }
      }
      if (sql.includes('pg_stat_replication')) {
        return { rows: [], fields: [] }
      }
      return { rows: [], fields: [] }
    })

    const tools = createPostgresHealthTools() as any
    const result = await tools.get_postgres_metrics.execute({ pgHostId: 0 })

    expect(result.version).toBe('PostgreSQL 17.0')
    expect(result.uptime_seconds).toBe(3600)
    expect(result.connections.total).toBe(8)
    expect(result.connections.by_state).toEqual({ active: 3, idle: 5 })
    // 900 hits / (900 + 100) = 90.00%
    expect(result.cache.hit_pct).toBe(90)
    expect(result.transactions.xact_commit).toBe(50)
    expect(result.transactions.deadlocks).toBe(0)
    expect(result.database.size_bytes).toBe(1048576)
    expect(result.replication.is_replica).toBe(false)
    expect(result.replication.standbys).toEqual([])
  })

  test('reports replica lag when the source is in recovery', async () => {
    mockRun.mockImplementation(async (_id: number, sql: string) => {
      if (sql.includes('pg_postmaster_start_time')) {
        return {
          rows: [
            {
              version: 'PostgreSQL 17.0',
              uptime_seconds: '10',
              blks_hit: '0',
              blks_read: '0',
              xact_commit: '0',
              xact_rollback: '0',
              deadlocks: '0',
              db_size_bytes: '0',
              db_size: '0 bytes',
              is_replica: true,
              replica_lag_seconds: 1.5,
            },
          ],
          fields: [],
        }
      }
      return { rows: [], fields: [] }
    })

    const tools = createPostgresHealthTools() as any
    const result = await tools.get_postgres_metrics.execute({ pgHostId: 0 })
    expect(result.replication.is_replica).toBe(true)
    expect(result.replication.replica_lag_seconds).toBe(1.5)
    // No blocks read/hit → cache hit ratio is null, not a divide-by-zero.
    expect(result.cache.hit_pct).toBeNull()
  })
})
