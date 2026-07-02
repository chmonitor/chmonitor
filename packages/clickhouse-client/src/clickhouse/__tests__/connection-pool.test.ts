import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'

mock.module('@chm/logger', () => ({
  debug: mock(() => {}),
  error: mock(() => {}),
  warn: mock(() => {}),
  isDebugEnabled: mock(() => false),
}))

const {
  clientPool,
  getPoolKey,
  getPooledClient,
  cleanupStaleClients,
  getConnectionPoolStats,
} = await import(
  new URL('../connection-pool.ts?test=pool', import.meta.url).href
)

describe('getPoolKey', () => {
  it('generates key from host, user, and web flag', () => {
    const config = {
      id: 0,
      host: 'http://localhost:8123',
      user: 'admin',
      password: 'secret',
    }
    expect(getPoolKey(config, false)).toBe('http://localhost:8123:admin:false')
    expect(getPoolKey(config, true)).toBe('http://localhost:8123:admin:true')
  })

  it('differentiates web vs non-web clients', () => {
    const config = { id: 0, host: 'host', user: 'user', password: '' }
    expect(getPoolKey(config, false)).not.toBe(getPoolKey(config, true))
  })

  it('differentiates different hosts', () => {
    const c1 = { id: 0, host: 'host1', user: 'user', password: '' }
    const c2 = { id: 1, host: 'host2', user: 'user', password: '' }
    expect(getPoolKey(c1, false)).not.toBe(getPoolKey(c2, false))
  })

  it('differentiates different users on same host', () => {
    const c1 = { id: 0, host: 'host', user: 'user1', password: '' }
    const c2 = { id: 0, host: 'host', user: 'user2', password: '' }
    expect(getPoolKey(c1, false)).not.toBe(getPoolKey(c2, false))
  })
})

describe('getPooledClient', () => {
  beforeEach(() => {
    clientPool.clear()
  })

  afterAll(() => {
    clientPool.clear()
    mock.restore()
  })

  it('creates a new pooled client when none exists', () => {
    const config = { id: 0, host: 'host1', user: 'admin', password: 'pw' }
    const fakeClient = { query: mock(() => {}) }

    const pooled = getPooledClient(fakeClient, config, false)

    expect(pooled.client).toBe(fakeClient)
    expect(pooled.createdAt).toBeGreaterThan(0)
    expect(pooled.lastUsed).toBeGreaterThan(0)
    expect(pooled.inUse).toBe(0)
    expect(clientPool.has('host1:admin:false')).toBe(true)
  })

  it('reuses existing pooled client on subsequent calls', () => {
    const config = { id: 0, host: 'host1', user: 'admin', password: 'pw' }
    const fakeClient1 = { query: mock(() => {}) }
    const fakeClient2 = { query: mock(() => {}) }

    const first = getPooledClient(fakeClient1, config, false)
    const second = getPooledClient(fakeClient2, config, false)

    // Should return the same pooled entry (with the first client)
    expect(second.client).toBe(fakeClient1)
    // The pool entry is the same object reference
    expect(first).toBe(second)
    // lastUsed should have been updated
    expect(second.lastUsed).toBeGreaterThanOrEqual(first.createdAt)
  })

  it('creates separate entries for different configs', () => {
    const config1 = { id: 0, host: 'host1', user: 'admin', password: 'pw' }
    const config2 = { id: 1, host: 'host2', user: 'admin', password: 'pw' }

    const fakeClient = { query: mock(() => {}) }
    getPooledClient(fakeClient, config1, false)
    getPooledClient(fakeClient, config2, false)

    expect(clientPool.size).toBe(2)
  })
})

describe('cleanupStaleClients', () => {
  beforeEach(() => {
    clientPool.clear()
  })

  it('removes stale clients that are not in use', () => {
    const config = { id: 0, host: 'stale-host', user: 'admin', password: '' }
    const fakeClient = { query: mock(() => {}) }

    const pooled = getPooledClient(fakeClient, config, false)
    // Simulate a very old lastUsed by manually setting it
    // The default timeout is 5 minutes (300000ms)
    pooled.lastUsed = Date.now() - 600_000 // 10 minutes ago
    pooled.inUse = 0

    cleanupStaleClients()
    expect(clientPool.size).toBe(0)
  })

  it('keeps stale clients that are still in use', () => {
    const config = { id: 0, host: 'active-host', user: 'admin', password: '' }
    const fakeClient = { query: mock(() => {}) }

    const pooled = getPooledClient(fakeClient, config, false)
    pooled.lastUsed = Date.now() - 600_000 // stale
    pooled.inUse = 1 // but in use

    cleanupStaleClients()
    expect(clientPool.size).toBe(1)
  })

  it('keeps recent clients', () => {
    const config = { id: 0, host: 'recent-host', user: 'admin', password: '' }
    const fakeClient = { query: mock(() => {}) }

    getPooledClient(fakeClient, config, false)
    // lastUsed is just now, so not stale

    cleanupStaleClients()
    expect(clientPool.size).toBe(1)
  })

  it('handles empty pool gracefully', () => {
    clientPool.clear()
    expect(() => cleanupStaleClients()).not.toThrow()
    expect(clientPool.size).toBe(0)
  })
})

describe('getConnectionPoolStats', () => {
  beforeEach(() => {
    clientPool.clear()
  })

  it('returns stats for empty pool', () => {
    const stats = getConnectionPoolStats()
    expect(stats.poolSize).toBe(0)
    expect(stats.totalInUse).toBe(0)
    expect(stats.totalIdle).toBe(0)
    expect(stats.clients).toEqual([])
    expect(stats.config.maxPoolSize).toBeGreaterThan(0)
  })

  it('returns stats for populated pool', () => {
    const config = { id: 0, host: 'host1', user: 'admin', password: '' }
    const fakeClient = { query: mock(() => {}) }

    const pooled = getPooledClient(fakeClient, config, false)
    pooled.inUse = 3

    const stats = getConnectionPoolStats()
    expect(stats.poolSize).toBe(1)
    expect(stats.totalInUse).toBe(3)
    expect(stats.totalIdle).toBe(0)
    expect(stats.clients).toHaveLength(1)
    expect(stats.clients[0].key).toBe('host1:admin:false')
    expect(stats.clients[0].inUse).toBe(3)
  })

  it('reports mixed idle and in-use clients', () => {
    const config1 = { id: 0, host: 'host1', user: 'admin', password: '' }
    const config2 = { id: 1, host: 'host2', user: 'admin', password: '' }
    const fakeClient = { query: mock(() => {}) }

    const p1 = getPooledClient(fakeClient, config1, false)
    getPooledClient(fakeClient, config2, false)
    p1.inUse = 1

    const stats = getConnectionPoolStats()
    expect(stats.poolSize).toBe(2)
    expect(stats.totalInUse).toBe(1)
    expect(stats.totalIdle).toBe(1)
  })

  it('includes config values', () => {
    const stats = getConnectionPoolStats()
    expect(stats.config.clientTimeoutMs).toBeGreaterThan(0)
    expect(stats.config.cleanupIntervalMs).toBeGreaterThan(0)
  })
})
