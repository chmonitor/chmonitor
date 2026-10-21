/**
 * Tests for the findings store (app-owned ClickHouse table for autonomous
 * monitoring records). Mocks @chm/clickhouse-client so we exercise the SQL
 * building, the "since" interval sanitization (security-relevant), the limit
 * clamp, and the best-effort degrade-on-failure contract — without a DB.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { ErrorLogger } from '@chm/logger'

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

// Every getClient() lease must be handed back — see issue #2946.
let getClientCalls = 0
let releaseClientCalls = 0

// NB: do NOT mock '@chm/logger' — replacing the whole module drops named
// exports other modules import (e.g. clerk-client's `error`), and bun's
// mock.module is global + persists across files. The real logger is harmless
// in tests. Only the data client is mocked.
mock.module('@chm/clickhouse-client', () => ({
  getClient: async () => {
    getClientCalls++
    return {
      command: (...a: unknown[]) => commandImpl.apply(null, a as []),
      insert: (arg: unknown) => insertImpl(arg),
    }
  },
  releaseClient: () => {
    releaseClientCalls++
  },
  fetchData: (arg: {
    query: string
    query_params?: Record<string, unknown>
  }) => {
    lastQuery = arg.query
    lastParams = arg.query_params ?? {}
    return fetchDataImpl(arg)
  },
}))

const { recordFinding, listRecentFindings, resetFindingsStoreForTests } =
  await import('./findings-store')

beforeEach(() => {
  resetFindingsStoreForTests()
  commandImpl = async () => ({})
  insertImpl = async () => ({})
  fetchDataImpl = async () => ({ data: [] })
  lastQuery = ''
  lastParams = {}
  getClientCalls = 0
  releaseClientCalls = 0
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

  // Regression coverage for issue #2946: getClient() leases a pooled client,
  // so ensureTable/recordFinding must hand every lease back — otherwise the
  // pool entry can never be reclaimed by cleanupStaleClients.
  test('releases every leased client on the happy path', async () => {
    await recordFinding(hostSeq++, {
      severity: 'info',
      category: 'x',
      source: 'y',
      title: 'z',
    })
    // One lease for ensureTable (CREATE TABLE), one for the insert.
    expect(getClientCalls).toBe(2)
    expect(releaseClientCalls).toBe(getClientCalls)
  })

  test('releases the leased client when CREATE TABLE fails', async () => {
    commandImpl = async () => {
      throw new Error('READONLY')
    }
    await recordFinding(hostSeq++, {
      severity: 'info',
      category: 'x',
      source: 'y',
      title: 'z',
    })
    expect(getClientCalls).toBe(1)
    expect(releaseClientCalls).toBe(getClientCalls)
  })

  test('releases the leased client when the insert fails', async () => {
    insertImpl = async () => {
      throw new Error('insert blew up')
    }
    await recordFinding(hostSeq++, {
      severity: 'info',
      category: 'x',
      source: 'y',
      title: 'z',
    })
    expect(getClientCalls).toBe(2)
    expect(releaseClientCalls).toBe(getClientCalls)
  })
})

describe('ensureTable negative cache', () => {
  const finding = {
    severity: 'info' as const,
    category: 'x',
    source: 'y',
    title: 'z',
  }
  let clock = 0
  let commandCalls = 0
  let warnings: string[] = []
  let warnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    clock = 1_000
    commandCalls = 0
    warnings = []
    resetFindingsStoreForTests({ now: () => clock, failureTtlMs: 600_000 })
    warnSpy = spyOn(ErrorLogger, 'logWarning').mockImplementation(((
      msg: string
    ) => {
      warnings.push(msg)
    }) as never)
    commandImpl = async () => {
      commandCalls++
      throw new Error('READONLY')
    }
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  const ensureWarnings = () =>
    warnings.filter((m) => m.includes('could not ensure'))

  test('concurrent writes on a failing host issue one CREATE and one warning', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => recordFinding(7, finding))
    )
    expect(results).toEqual([false, false, false, false, false])
    expect(commandCalls).toBe(1)
    expect(ensureWarnings()).toHaveLength(1)
    expect(releaseClientCalls).toBe(getClientCalls)
  })

  test('a later write within the TTL does not re-issue CREATE', async () => {
    expect(await recordFinding(7, finding)).toBe(false)
    clock += 599_000
    expect(await recordFinding(7, finding)).toBe(false)
    expect(commandCalls).toBe(1)
    expect(ensureWarnings()).toHaveLength(1)
  })

  test('retries after the TTL and caches a success', async () => {
    expect(await recordFinding(7, finding)).toBe(false)
    clock += 600_001
    commandImpl = async () => {
      commandCalls++
    }
    expect(await recordFinding(7, finding)).toBe(true)
    expect(commandCalls).toBe(2)
    expect(await recordFinding(7, finding)).toBe(true)
    expect(commandCalls).toBe(2)
  })

  test('a failure on one host does not block another host', async () => {
    expect(await recordFinding(7, finding)).toBe(false)
    commandImpl = async () => {
      commandCalls++
    }
    expect(await recordFinding(8, finding)).toBe(true)
  })

  test('an INSERT failure is not negative-cached and keeps warning', async () => {
    commandImpl = async () => {
      commandCalls++
    }
    insertImpl = async () => {
      throw new Error('insert blew up')
    }
    expect(await recordFinding(9, finding)).toBe(false)
    expect(await recordFinding(9, finding)).toBe(false)
    expect(
      warnings.filter((m) => m.includes('failed to record finding'))
    ).toHaveLength(2)
    insertImpl = async () => ({})
    expect(await recordFinding(9, finding)).toBe(true)
    expect(commandCalls).toBe(1)
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
