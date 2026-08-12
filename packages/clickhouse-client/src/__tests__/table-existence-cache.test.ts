// Read named exports lazily via the namespace so that tests in other files
// which jest.mock('./table-existence-cache', () => ({ tableExistenceCache:
// ... })) can't make these helpers undefined at import time when the full
// suite runs together.
import * as cache from '../table-existence-cache'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

// The L2 suite below loads the module under test through a `?test=l2`
// cache-buster, so hold BOTH connection-pool instances and assert on whichever
// one actually got leased (issue #2946 coverage).
const { clientPool: bustedPool } = await import(
  new URL('../clickhouse/connection-pool.ts?test=l2', import.meta.url).href
)
const { clientPool: plainPool } = await import('../clickhouse/connection-pool')

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
    bustedPool.clear()
    plainPool.clear()
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

  // Regression coverage for issue #2505: a probe failure (network/timeout/
  // auth) must be distinguishable from a confirmed-missing table.
  describe('transient probe failures (issue #2505)', () => {
    it('returns "unknown" (not false) when the probe query throws', async () => {
      mockClientQuery.mockRejectedValue(new Error('connection refused'))

      const result = await l2cache.checkTableExists(0, 'system', 'backup_log')

      expect(result).toBe('unknown')
    })

    it('never caches an "unknown" result — the next probe retries ClickHouse', async () => {
      mockClientQuery.mockRejectedValueOnce(new Error('timeout'))
      mockClientQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([{ count: '1' }]),
      })

      const first = await l2cache.checkTableExists(0, 'system', 'backup_log')
      expect(first).toBe('unknown')
      expect(l2cache.tableCacheSize()).toBe(0)

      const second = await l2cache.checkTableExists(0, 'system', 'backup_log')
      expect(second).toBe(true)
      expect(mockClientQuery).toHaveBeenCalledTimes(2)
    })

    it('does not write an "unknown" result to the L2 (KV) cache', async () => {
      const setSpy = mock(async () => {})
      l2cache.setTableExistenceL2Provider(() => ({
        get: async () => null,
        set: setSpy,
      }))
      mockClientQuery.mockRejectedValue(new Error('connection refused'))

      const result = await l2cache.checkTableExists(0, 'system', 'backup_log')

      expect(result).toBe('unknown')
      expect(setSpy).not.toHaveBeenCalled()
    })
  })

  // Regression coverage for issue #2946: getClient() leases the pooled client
  // (inUse++). Without a matching releaseClient the entry never drops back to
  // 0, so cleanupStaleClients can never reclaim it and totalInUse grows
  // monotonically.
  describe('pooled client lease (issue #2946)', () => {
    const expectEveryClientReleased = () => {
      const entries = [
        ...Array.from(bustedPool.values()),
        ...Array.from(plainPool.values()),
      ] as { inUse: number }[]
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.map((entry) => entry.inUse)).toEqual(entries.map(() => 0))
    }

    it('releases the pooled client after a successful probe', async () => {
      await l2cache.checkTableExists(0, 'system', 'backup_log')

      expectEveryClientReleased()
    })

    it('releases the pooled client when the probe throws', async () => {
      mockClientQuery.mockRejectedValue(new Error('connection refused'))

      await l2cache.checkTableExists(0, 'system', 'backup_log')

      expectEveryClientReleased()
    })
  })

  // Regression coverage for issue #2953: a cold isolate mounting a dozen
  // charts used to fire a dozen identical probes that all raced to cache.set.
  describe('in-flight probe dedup (issue #2953)', () => {
    it('runs one query for concurrent probes of the same table', async () => {
      const results = await Promise.all([
        l2cache.checkTableExists(0, 'system', 'backup_log'),
        l2cache.checkTableExists(0, 'system', 'backup_log'),
        l2cache.checkTableExists(0, 'system', 'backup_log'),
      ])

      expect(results).toEqual([true, true, true])
      expect(mockClientQuery).toHaveBeenCalledTimes(1)
    })

    it('still probes separately for different tables', async () => {
      await Promise.all([
        l2cache.checkTableExists(0, 'system', 'backup_log'),
        l2cache.checkTableExists(0, 'system', 'error_log'),
      ])

      expect(mockClientQuery).toHaveBeenCalledTimes(2)
    })

    it('clears the in-flight entry so a later probe can retry', async () => {
      mockClientQuery.mockRejectedValueOnce(new Error('timeout'))

      const [first, second] = await Promise.all([
        l2cache.checkTableExists(0, 'system', 'backup_log'),
        l2cache.checkTableExists(0, 'system', 'backup_log'),
      ])
      // Both joined the same failed probe — nothing cached.
      expect(first).toBe('unknown')
      expect(second).toBe('unknown')
      expect(mockClientQuery).toHaveBeenCalledTimes(1)

      // The registry entry was removed, so a fresh probe runs.
      const retried = await l2cache.checkTableExists(0, 'system', 'backup_log')
      expect(retried).toBe(true)
      expect(mockClientQuery).toHaveBeenCalledTimes(2)
    })
  })
})
