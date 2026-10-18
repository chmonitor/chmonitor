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

  it('invalidateTable on a missing key is a no-op (no throw)', async () => {
    await cache.invalidateTable(0, 'default', 'never_set')
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
      delete: async () => {},
      deletePrefix: async () => {},
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
      delete: async () => {},
      deletePrefix: async () => {},
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

  // Regression for #3514: invalidateTable used to clear only L1, so the next
  // probe re-read the stale L2 value and re-armed L1 with a full TTL.
  it('invalidateTable clears L2 so the next probe sees the flipped value', async () => {
    const l2 = new Map<string, boolean>([['0:system.backup_log', false]])
    l2cache.setTableExistenceL2Provider(() => ({
      get: async (k) => l2.get(k) ?? null,
      set: async (k, v) => {
        l2.set(k, v)
      },
      delete: async (k) => {
        l2.delete(k)
      },
      deletePrefix: async (p) => {
        for (const k of [...l2.keys()]) if (k.startsWith(p)) l2.delete(k)
      },
    }))

    expect(await l2cache.checkTableExists(0, 'system', 'backup_log')).toBe(
      false
    )

    // The table is created; the probe would now report it.
    await l2cache.invalidateTable(0, 'system', 'backup_log')

    expect(await l2cache.checkTableExists(0, 'system', 'backup_log')).toBe(true)
  })

  it('invalidateTable also clears the table column keys in L1 and L2', async () => {
    const l2 = new Map<string, boolean>([['0:system.backup_log.status', false]])
    const deletePrefix = mock(async (p: string) => {
      for (const k of [...l2.keys()]) if (k.startsWith(p)) l2.delete(k)
    })
    l2cache.setTableExistenceL2Provider(() => ({
      get: async (k) => l2.get(k) ?? null,
      set: async (k, v) => {
        l2.set(k, v)
      },
      delete: async (k) => {
        l2.delete(k)
      },
      deletePrefix,
    }))

    expect(
      await l2cache.checkColumnExists(0, 'system', 'backup_log', 'status')
    ).toBe(false)
    await l2cache.invalidateTable(0, 'system', 'backup_log')

    expect(deletePrefix).toHaveBeenCalledWith('0:system.backup_log.')
    expect(
      await l2cache.checkColumnExists(0, 'system', 'backup_log', 'status')
    ).toBe(true)
  })

  it('invalidateTable does not touch a different table sharing a name prefix', async () => {
    const l2 = new Map<string, boolean>([['0:system.backup_log2', false]])
    l2cache.setTableExistenceL2Provider(() => ({
      get: async (k) => l2.get(k) ?? null,
      set: async () => {},
      delete: async (k) => {
        l2.delete(k)
      },
      deletePrefix: async (p) => {
        for (const k of [...l2.keys()]) if (k.startsWith(p)) l2.delete(k)
      },
    }))

    await l2cache.checkTableExists(0, 'system', 'backup_log2')
    await l2cache.invalidateTable(0, 'system', 'backup_log')

    expect(l2.has('0:system.backup_log2')).toBe(true)
  })

  it('a probe already in flight during invalidateTable does not re-arm the cache with its stale result', async () => {
    let release!: () => void
    mockClientQuery.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              json: () => Promise.resolve([{ count: '0', sentinel: '1' }]),
            })
        })
    )

    const stale = l2cache.checkTableExists(0, 'system', 'backup_log')
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    await l2cache.invalidateTable(0, 'system', 'backup_log')
    release()
    expect(await stale).toBe(false)

    // Not cached: the next call probes again and sees the new value.
    expect(await l2cache.checkTableExists(0, 'system', 'backup_log')).toBe(true)
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
  describe('grant-filtered system.tables (#3895)', () => {
    it('a system table missing from a filtered listing is hidden, and not cached', async () => {
      mockClientQuery.mockResolvedValue({
        json: () => Promise.resolve([{ count: '0', sentinel: '0' }]),
      })

      expect(await l2cache.checkTableExists(0, 'system', 'backup_log')).toBe(
        'hidden'
      )
      expect(l2cache.tableCacheSize()).toBe(0)
    })

    it('a system table missing from a full listing is still missing', async () => {
      mockClientQuery.mockResolvedValue({
        json: () => Promise.resolve([{ count: '0', sentinel: '1' }]),
      })

      expect(await l2cache.checkTableExists(0, 'system', 'backup_log')).toBe(
        false
      )
    })

    it('a non-system table is never reported hidden', async () => {
      mockClientQuery.mockResolvedValue({
        json: () => Promise.resolve([{ count: '0', sentinel: '0' }]),
      })

      expect(await l2cache.checkTableExists(0, 'app', 'events')).toBe(false)
    })

    // The sentinel row (system.one) is in the result set of every probe, so
    // the count must match the database too, or `<db>.one` reads as present.
    // Runs the real probe SQL in `clickhouse local`.
    const ch = Bun.which('clickhouse')
    it.skipIf(!ch)(
      '`<db>.one` is missing when only system.one exists',
      async () => {
        mockClientQuery.mockImplementation((async ({
          query,
          query_params,
        }: {
          query: string
          query_params: Record<string, string>
        }) => {
          const params = Object.entries(query_params).map(
            ([k, v]) => `--param_${k}=${v}`
          )
          const out = Bun.spawnSync([
            ch as string,
            'local',
            ...params,
            '-q',
            `${query} FORMAT JSONEachRow`,
          ])
          if (out.exitCode !== 0) throw new Error(out.stderr.toString())
          const row = JSON.parse(out.stdout.toString().trim())
          return { json: () => Promise.resolve([row]) }
        }) as never)

        expect(await l2cache.checkTableExists(0, 'default', 'one')).toBe(false)
        expect(await l2cache.checkTableExists(0, 'system', 'one')).toBe(true)
      }
    )
  })

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
        delete: async () => {},
        deletePrefix: async () => {},
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

  describe('checkTablesExist (batched)', () => {
    it('cold cache: one query for all tables, same answers as per-table, and seeds the cache', async () => {
      mockClientQuery.mockResolvedValue({
        json: () =>
          Promise.resolve([
            { database: 'system', name: 'backup_log' },
            { database: 'system', name: 'error_log' },
            { database: 'system', name: 'one' },
          ]),
      })
      const pairs = [
        ['system', 'backup_log'],
        ['system', 'error_log'],
        ['system', 'zookeeper'],
      ] as const

      const batch = await l2cache.checkTablesExist(0, pairs)

      expect(mockClientQuery).toHaveBeenCalledTimes(1)
      expect(batch.get('system.backup_log')).toBe(true)
      expect(batch.get('system.error_log')).toBe(true)
      expect(batch.get('system.zookeeper')).toBe(false)

      // Seeded: the per-table path now answers from cache, identically.
      mockClientQuery.mockClear()
      expect(await l2cache.checkTableExists(0, 'system', 'backup_log')).toBe(
        true
      )
      expect(await l2cache.checkTableExists(0, 'system', 'zookeeper')).toBe(
        false
      )
      expect(mockClientQuery).not.toHaveBeenCalled()
    })

    // @clickhouse/client serializes a JS array of pairs as nested arrays
    // ([['system','a']]), which ClickHouse cannot parse as
    // Array(Tuple(String, String)) — so every batch failed live (#3906).
    // Only flat string arrays survive serialization.
    it('sends only flat Array(String) params, never tuple params', async () => {
      mockClientQuery.mockResolvedValue({ json: () => Promise.resolve([]) })

      await l2cache.checkTablesExist(0, [
        ['system', 'processes'],
        ['default', 'events'],
      ])

      const [{ query, query_params }] = mockClientQuery.mock
        .calls[0] as unknown as [
        { query: string; query_params: Record<string, unknown> },
      ]
      expect(query).not.toContain('Tuple')
      expect(query_params).toEqual({
        databases: ['system', 'default', 'system'],
        tables: ['processes', 'events', 'one'],
      })
    })

    it('warm cache: no query at all', async () => {
      mockClientQuery.mockResolvedValue({
        json: () => Promise.resolve([{ database: 'system', name: 'a' }]),
      })
      await l2cache.checkTablesExist(0, [['system', 'a']])
      mockClientQuery.mockClear()

      const again = await l2cache.checkTablesExist(0, [['system', 'a']])
      expect(again.get('system.a')).toBe(true)
      expect(mockClientQuery).not.toHaveBeenCalled()
    })

    it('a grant-filtered view reports unseen system tables as hidden, not missing (#3895)', async () => {
      // Live on 26.5 as a user with only GRANT SELECT ON system.parts:
      // system.tables lists `parts` and nothing else, not even `one`.
      mockClientQuery.mockResolvedValue({
        json: () => Promise.resolve([{ database: 'system', name: 'parts' }]),
      })

      const batch = await l2cache.checkTablesExist(0, [
        ['system', 'parts'],
        ['system', 'backup_log'],
        ['app', 'events'],
      ])

      expect(batch.get('system.parts')).toBe(true)
      expect(batch.get('system.backup_log')).toBe('hidden')
      expect(batch.get('app.events')).toBe(false)
      // Not cached: a later GRANT is seen on the next probe.
      expect(l2cache.tableCacheSize()).toBe(2)
    })

    it('failed query yields unknown, never false, and caches nothing', async () => {
      mockClientQuery.mockRejectedValueOnce(new Error('timeout'))

      const batch = await l2cache.checkTablesExist(0, [['system', 'a']])

      expect(batch.get('system.a')).toBe('unknown')
      expect(l2cache.tableCacheSize()).toBe(0)
    })
  })
})
