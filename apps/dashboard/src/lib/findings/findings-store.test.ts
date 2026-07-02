/**
 * Tests for the findings store (app-owned ClickHouse table for autonomous
 * monitoring records). Mocks @chm/clickhouse-client so we exercise the SQL
 * building, the "since" interval sanitization (security-relevant), the limit
 * clamp, and the best-effort degrade-on-failure contract — without a DB.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

// ── Mutable hooks the mock reads, so each test controls behavior. ──
let commandImpl: () => Promise<unknown> = async () => ({})
let insertImpl: (arg: unknown) => Promise<unknown> = async () => ({})
let fetchDataImpl: (arg: {
  query: string
  query_params?: Record<string, unknown>
}) => Promise<unknown> = async () => ({ data: [] })

// Capture the last fetchData call for assertions.
let lastQuery = ''
let lastParams: Record<string, unknown> = {}

// NB: do NOT mock '@chm/logger' — replacing the whole module drops named
// exports other modules import (e.g. clerk-client's `error`), and bun's
// mock.module is global + persists across files. The real logger is harmless
// in tests. Only the data client is mocked.
mock.module('@chm/clickhouse-client', () => ({
  getClient: async () => ({
    command: (...a: unknown[]) => commandImpl.apply(null, a as []),
    insert: (arg: unknown) => insertImpl(arg),
  }),
  fetchData: (arg: {
    query: string
    query_params?: Record<string, unknown>
  }) => {
    lastQuery = arg.query
    lastParams = arg.query_params ?? {}
    return fetchDataImpl(arg)
  },
}))

const { recordFinding, listRecentFindings } = await import('./findings-store')

beforeEach(() => {
  commandImpl = async () => ({})
  insertImpl = async () => ({})
  fetchDataImpl = async () => ({ data: [] })
  lastQuery = ''
  lastParams = {}
})

// Use a unique hostId per recordFinding test — ensureTable() memoizes success
// per-host in a module-level Set, so re-using an id would skip CREATE TABLE.
let hostSeq = 1000

describe('recordFinding', () => {
  test('inserts and returns true when the table can be ensured', async () => {
    let inserted: unknown
    insertImpl = async (arg) => {
      inserted = arg
      return {}
    }
    const ok = await recordFinding(hostSeq++, {
      severity: 'warning',
      category: 'merges',
      source: 'cron',
      title: 'stuck mutation',
    })
    expect(ok).toBe(true)
    expect((inserted as { table: string }).table).toBeDefined()
    // Optional fields default rather than being omitted.
    const row = (inserted as { values: Array<Record<string, unknown>> })
      .values[0]
    expect(row.detail).toBe('')
    expect(row.value).toBe(0)
    expect(row.severity).toBe('warning')
  })

  test('returns false (no throw) when CREATE TABLE fails (read-only cluster)', async () => {
    commandImpl = async () => {
      throw new Error('READONLY')
    }
    const ok = await recordFinding(hostSeq++, {
      severity: 'info',
      category: 'x',
      source: 'y',
      title: 'z',
    })
    expect(ok).toBe(false)
  })

  test('returns false when the insert itself fails', async () => {
    insertImpl = async () => {
      throw new Error('insert blew up')
    }
    const ok = await recordFinding(hostSeq++, {
      severity: 'critical',
      category: 'x',
      source: 'y',
      title: 'z',
    })
    expect(ok).toBe(false)
  })
})

describe('listRecentFindings', () => {
  test('returns rows and always filters by host', async () => {
    fetchDataImpl = async () => ({
      data: [{ title: 'a' }, { title: 'b' }],
    })
    const rows = await listRecentFindings(1)
    expect(rows).toHaveLength(2)
    expect(lastQuery).toContain('host_id = {hostId:String}')
    expect(lastParams.hostId).toBe('1')
  })

  test('adds a severity predicate + param when given', async () => {
    await listRecentFindings(1, { severity: 'critical' })
    expect(lastQuery).toContain('severity = {severity:String}')
    expect(lastParams.severity).toBe('critical')
  })

  test('accepts a valid "since" interval and injects it', async () => {
    await listRecentFindings(1, { since: '24 HOUR' })
    expect(lastQuery).toContain('event_time >= now() - INTERVAL 24 HOUR')
  })

  test('ignores an invalid / injection-y "since" value', async () => {
    await listRecentFindings(1, { since: '1; DROP TABLE x' })
    expect(lastQuery).not.toContain('DROP TABLE')
    expect(lastQuery).not.toContain('INTERVAL 1;')
  })

  test('clamps the limit into [1, 1000]', async () => {
    await listRecentFindings(1, { limit: 99999 })
    expect(lastQuery).toContain('LIMIT 1000')
    await listRecentFindings(1, { limit: -5 })
    expect(lastQuery).toContain('LIMIT 1')
  })

  test('returns [] (no throw) when the query errors', async () => {
    fetchDataImpl = async () => ({ error: { message: 'boom' } })
    expect(await listRecentFindings(1)).toEqual([])
  })

  // Regression: #2173 — filtering/ordering must run on the real DateTime
  // `event_time` column inside a subquery, and the string formatting must live
  // only in the OUTER select. Otherwise `toString(event_time) AS event_time`
  // shadows the DateTime column and `WHERE event_time >= now() - INTERVAL ...`
  // / `ORDER BY event_time` compare String vs DateTime → Code 386
  // NO_COMMON_TYPE.
  test('filters and orders inside a subquery on the real DateTime column (#2173)', async () => {
    await listRecentFindings(1, { since: '24 HOUR' })

    // The query wraps an inner SELECT.
    const innerStart = lastQuery.indexOf('FROM (')
    expect(innerStart).toBeGreaterThan(-1)

    // The WHERE (host filter + since) and ORDER BY live inside the subquery,
    // i.e. after the `FROM (` that opens it.
    const wherePos = lastQuery.indexOf('WHERE host_id')
    const sincePos = lastQuery.indexOf('event_time >= now() - INTERVAL 24 HOUR')
    const orderPos = lastQuery.indexOf('ORDER BY event_time DESC')
    expect(wherePos).toBeGreaterThan(innerStart)
    expect(sincePos).toBeGreaterThan(innerStart)
    expect(orderPos).toBeGreaterThan(innerStart)

    // The string formatting is in the OUTER select, before the subquery opens.
    const toStringPos = lastQuery.indexOf('toString(event_time) AS event_time')
    expect(toStringPos).toBeGreaterThan(-1)
    expect(toStringPos).toBeLessThan(innerStart)
  })
})
