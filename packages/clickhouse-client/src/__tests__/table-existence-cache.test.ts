// Read named exports lazily via the namespace so that tests in other files
// which jest.mock('./table-existence-cache', () => ({ tableExistenceCache:
// ... })) can't make these helpers undefined at import time when the full
// suite runs together.
import * as cache from '../table-existence-cache'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

// These tests only touch the public side-effect-free shims around the LRU
// cache (size / invalidate / clear / metrics). The async checkTableExists
// path is skipped here — it hits the ClickHouse client and lives in the
// integration-suite.

beforeEach(() => {
  cache.clearTableCache?.()
})

describe('tableExistenceCache shims', () => {
  it('starts empty after a clear', () => {
    expect(cache.tableCacheSize()).toBe(0)
  })

  it('getCacheMetrics reports an empty hit rate when the cache is empty', () => {
    const metrics = cache.getCacheMetrics()

    expect(metrics.size).toBe(0)
    expect(metrics.hitRate).toBe('empty')
    expect(metrics.memoryLimit).toBe('1MB')
    expect(metrics.ttl).toBe('5 minutes')
  })

  it('invalidateTable on a missing key is a no-op (no throw)', () => {
    expect(() => cache.invalidateTable(0, 'default', 'never_set')).not.toThrow()
    expect(cache.tableCacheSize()).toBe(0)
  })

  it('clearTableCache wipes the cache', () => {
    cache.clearTableCache()
    expect(cache.tableCacheSize()).toBe(0)
  })

  // Note: a namespace-shape assertion lived here briefly but had to be
  // removed because table-validator.test.ts uses
  // `jest.mock('./table-existence-cache', () => ({ tableExistenceCache: {
  // checkTableExists } }))` and the mock survives across files in the same
  // Bun session, leaving the other shim methods undefined.
  it('checkTableExists is exposed through the legacy namespace', () => {
    expect(typeof cache.tableExistenceCache.checkTableExists).toBe('function')
  })
})

describe('checkTableExists — L2 (KV) cache wiring (issue #2183)', () => {
  // Mocked/isolated the same way as clickhouse-version.test.ts: a fresh
  // module instance (via the `?test=` query cache-buster) so this suite's
  // client mock doesn't leak into the unmocked shims describe above.
  const mockClientQuery = mock(() =>
    Promise.resolve({ json: () => Promise.resolve([{ count: '1' }]) })
  )
  const mockClient = { query: mockClientQuery }
  const mockCreateClient = mock(() => mockClient)

  mock.module('@clickhouse/client', () => ({
    createClient: mockCreateClient,
  }))
  mock.module('@clickhouse/client-web', () => ({
    createClient: mockCreateClient,
  }))

  let l2cache: typeof import('../table-existence-cache')

  beforeEach(async () => {
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123'
    process.env.CLICKHOUSE_USER = 'default'
    process.env.CLICKHOUSE_PASSWORD = ''
    mockCreateClient.mockReset()
    mockClientQuery.mockReset()
    mockCreateClient.mockReturnValue(mockClient)
    mockClientQuery.mockResolvedValue({
      json: () => Promise.resolve([{ count: '1' }]),
    })

    l2cache = await import(
      new URL('../table-existence-cache.ts?test=l2', import.meta.url).href
    )
    l2cache.clearTableCache()
    l2cache.setTableExistenceL2Provider(null)
  })

  it('returns the L2 cache hit without querying ClickHouse', async () => {
    l2cache.setTableExistenceL2Provider(() => ({
      get: async () => true,
      set: async () => {},
    }))

    const result = await l2cache.checkTableExists(0, 'system', 'backup_log')

    expect(result).toBe(true)
    expect(mockClientQuery).not.toHaveBeenCalled()
  })

  it('queries ClickHouse and populates the L2 cache on an L2 miss', async () => {
    const setSpy = mock(async () => {})
    l2cache.setTableExistenceL2Provider(() => ({
      get: async () => null,
      set: setSpy,
    }))

    const result = await l2cache.checkTableExists(0, 'system', 'backup_log')

    expect(result).toBe(true)
    expect(mockClientQuery).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledTimes(1)
    const [key, exists, ttlSeconds] = setSpy.mock.calls[0]
    expect(key).toBe('0:system.backup_log')
    expect(exists).toBe(true)
    expect(ttlSeconds).toBe(5 * 60) // 5min, matching the L1 TTL
  })

  it('degrades to L1-LRU-only when no L2 provider is registered (Node/self-hosted path)', async () => {
    // No `setTableExistenceL2Provider` call — mirrors the Node/self-hosted
    // build, where `src/start.ts` never wires a provider.
    const first = await l2cache.checkTableExists(0, 'system', 'backup_log')
    expect(first).toBe(true)
    expect(mockClientQuery).toHaveBeenCalledTimes(1)

    const second = await l2cache.checkTableExists(0, 'system', 'backup_log')
    expect(second).toBe(true)
    expect(mockClientQuery).toHaveBeenCalledTimes(1)
  })
})
