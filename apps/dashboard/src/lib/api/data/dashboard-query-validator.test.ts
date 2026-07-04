/**
 * Tests for dashboard-query-validator.ts — specifically the KV (L2) cache
 * layer added in #2185 on top of the existing in-memory (L1) cache.
 *
 * The single invariant under test: a KV miss, a KV read error, or a missing
 * `CHM_DASHBOARD_QUERY_KV` binding (self-hosted/Node) must NEVER be treated as
 * "allow" — it must always fall through to the authoritative ClickHouse
 * allowlist query, preserving the fail-closed behavior of the validator.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from 'bun:test'

// ── Stub external I/O before importing the module under test. ─────────────

type FetchDataResult = {
  data?: Array<{ query: string }>
  error?: unknown
}

let fetchDataImpl: (...args: unknown[]) => Promise<FetchDataResult> =
  async () => ({ data: [], error: null })
let fetchDataCallCount = 0

mock.module('@chm/clickhouse-client', () => ({
  fetchData: (...args: unknown[]) => {
    fetchDataCallCount++
    return fetchDataImpl(...args)
  },
}))

mock.module('@chm/logger', () => ({
  error: () => {},
  warn: () => {},
  debug: () => {},
}))

mock.module('@/lib/app-tables', () => ({
  DASHBOARD_CHARTS_TABLE: 'clickhouse_monitoring_custom_dashboard',
}))

// ── Import AFTER mocks are registered ──────────────────────────────────────

import { clearHostCache } from './cache-manager'
import { validateDashboardQuery } from './dashboard-query-validator'

// Fake KV namespace installed on globalThis to simulate the Cloudflare
// binding. `getKV()` (dashboard-query-kv-cache.ts) auto-detects it there.
interface FakeKV {
  get: (key: string, opts?: unknown) => Promise<unknown>
  put: (key: string, value: string, opts?: unknown) => Promise<void>
}

function installKV(kv: FakeKV) {
  ;(
    globalThis as unknown as { CHM_DASHBOARD_QUERY_KV: FakeKV }
  ).CHM_DASHBOARD_QUERY_KV = kv
}

function removeKV() {
  delete (globalThis as unknown as { CHM_DASHBOARD_QUERY_KV?: FakeKV })
    .CHM_DASHBOARD_QUERY_KV
}

let hostCounter = 1000
function nextHost(): number {
  // Distinct hostId per test avoids cross-test pollution of the module-level
  // in-memory L1 cache (cache-manager.ts) between assertions.
  hostCounter++
  return hostCounter
}

// `cache-manager.ts` (the L1 in-memory cache) is a module-level singleton
// shared with `cache-manager.test.ts`, which drives it via a fixed fake
// epoch starting at 1_700_000_000_000. Pin the clock here to a fixed point
// safely below that (well outside its TTL window) for the whole file so
// `validateDashboardQuery`'s L1 writes never leave a real wall-clock
// timestamp behind that could desync that other suite's TTL-expiry math,
// regardless of which test file bun runs first.
const FAKE_NOW = 1_600_000_000_000

beforeAll(() => {
  setSystemTime(FAKE_NOW)
})

afterAll(() => {
  setSystemTime() // restore the real clock
})

beforeEach(() => {
  fetchDataCallCount = 0
  fetchDataImpl = async () => ({ data: [], error: null })
})

afterEach(() => {
  removeKV()
})

describe('validateDashboardQuery — KV (L2) cache, fail-closed semantics', () => {
  test('KV cache hit containing the query short-circuits without querying ClickHouse', async () => {
    const hostId = nextHost()
    const query = 'SELECT count() FROM system.tables'

    installKV({
      get: async () => [query],
      put: async () => {},
    })
    fetchDataImpl = async () => {
      throw new Error('fetchData must not be called on a KV hit')
    }

    const result = await validateDashboardQuery(query, hostId)

    expect(result.valid).toBe(true)
    expect(fetchDataCallCount).toBe(0)
  })

  test('fail-closed: KV get() throwing falls through to ClickHouse, and rejects when the table is inaccessible', async () => {
    const hostId = nextHost()
    const query = 'SELECT count() FROM system.tables'

    installKV({
      get: async () => {
        throw new Error('KV is unavailable')
      },
      put: async () => {},
    })
    fetchDataImpl = async () => ({
      data: [],
      error: 'Table does not exist',
    })

    const result = await validateDashboardQuery(query, hostId)

    // The KV failure must NOT be treated as an allow — the authoritative
    // ClickHouse check ran and (because the table errored) the request is
    // rejected, exactly as it would be with no KV layer at all.
    expect(result.valid).toBe(false)
    expect(result.error?.type).toBe('permission_error')
    expect(fetchDataCallCount).toBe(1)
  })

  test('fail-closed: KV miss (null) falls through to ClickHouse, and rejects when the query is not allow-listed', async () => {
    const hostId = nextHost()
    const query = 'SELECT count() FROM system.tables'

    installKV({
      get: async () => null,
      put: async () => {},
    })
    fetchDataImpl = async () => ({
      data: [{ query: 'SELECT 1' }], // allow-list exists, but not our query
      error: null,
    })

    const result = await validateDashboardQuery(query, hostId)

    expect(result.valid).toBe(false)
    expect(result.error?.type).toBe('permission_error')
    expect(fetchDataCallCount).toBe(1)
  })

  test('fail-closed: KV snapshot present but missing this query falls through and can still be rejected', async () => {
    const hostId = nextHost()
    const query = 'SELECT count() FROM system.tables'

    installKV({
      get: async () => ['SELECT 1', 'SELECT 2'], // stale snapshot, no match
      put: async () => {},
    })
    fetchDataImpl = async () => ({
      data: [{ query: 'SELECT 1' }, { query: 'SELECT 2' }], // still not allow-listed
      error: null,
    })

    const result = await validateDashboardQuery(query, hostId)

    expect(result.valid).toBe(false)
    expect(fetchDataCallCount).toBe(1)
  })

  test('no KV binding (self-hosted/Node): behaves exactly like the pre-existing in-memory-only path', async () => {
    const hostId = nextHost()
    const query = 'SELECT count() FROM system.tables'

    removeKV()
    fetchDataImpl = async () => ({
      data: [{ query }],
      error: null,
    })

    const result = await validateDashboardQuery(query, hostId)

    expect(result.valid).toBe(true)
    expect(fetchDataCallCount).toBe(1)
  })

  test('a successful ClickHouse validation writes through to KV', async () => {
    const hostId = nextHost()
    const query = 'SELECT count() FROM system.tables'
    const putCalls: Array<{ key: string; value: string }> = []

    installKV({
      get: async () => null,
      put: async (key: string, value: string) => {
        putCalls.push({ key, value })
      },
    })
    fetchDataImpl = async () => ({
      data: [{ query }],
      error: null,
    })

    const result = await validateDashboardQuery(query, hostId)

    expect(result.valid).toBe(true)
    expect(putCalls).toHaveLength(1)
    expect(putCalls[0]!.key).toBe(`dashboard-queries:${hostId}`)
    expect(JSON.parse(putCalls[0]!.value)).toContain(query)
  })

  test('an unexpected error during KV write-through does not fail the (already-valid) request', async () => {
    const hostId = nextHost()
    const query = 'SELECT count() FROM system.tables'

    installKV({
      get: async () => null,
      put: async () => {
        throw new Error('KV put failed')
      },
    })
    fetchDataImpl = async () => ({
      data: [{ query }],
      error: null,
    })

    const result = await validateDashboardQuery(query, hostId)

    expect(result.valid).toBe(true)
  })
})

describe('validateDashboardQuery — L1 in-memory cache still short-circuits (regression guard)', () => {
  test('a query already cached in L1 never touches KV or ClickHouse', async () => {
    const hostId = nextHost()
    const query = 'SELECT count() FROM system.tables'

    let kvGetCallCount = 0
    installKV({
      get: async () => {
        kvGetCallCount++
        return null // cold KV too, first call falls through to ClickHouse
      },
      put: async () => {},
    })
    fetchDataImpl = async () => ({
      data: [{ query }],
      error: null,
    })

    // Warm L1 via a first successful validation (this call does consult KV).
    const first = await validateDashboardQuery(query, hostId)
    expect(first.valid).toBe(true)
    expect(fetchDataCallCount).toBe(1)
    expect(kvGetCallCount).toBe(1)

    // Second call must hit L1 only — no KV, no ClickHouse.
    const second = await validateDashboardQuery(query, hostId)
    expect(second.valid).toBe(true)
    expect(fetchDataCallCount).toBe(1)
    expect(kvGetCallCount).toBe(1)

    clearHostCache(hostId)
  })
})
