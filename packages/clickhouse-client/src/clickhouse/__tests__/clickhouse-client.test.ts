import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'

const mockCreateClient = mock(() => ({}))
const mockCreateClientWeb = mock(() => ({}))

mock.module('@clickhouse/client', () => ({
  createClient: mockCreateClient,
}))

mock.module('@clickhouse/client-web', () => ({
  createClient: mockCreateClientWeb,
}))

mock.module('@chm/logger', () => ({
  debug: mock(() => {}),
  error: mock(() => {}),
  warn: mock(() => {}),
  isDebugEnabled: mock(() => false),
}))

// Mock the cloudflare-workers runtime detection
const mockIsCloudflareWorkers = mock(() => false)
mock.module('../../runtime/cloudflare-workers', () => ({
  isCloudflareWorkers: mockIsCloudflareWorkers,
}))

// _resetEnvCache is re-exported from clickhouse-client so it resets the SAME
// env-schema instance that getClient() uses internally.
const { getClient, releaseClient, isCloudflareWorkers, _resetEnvCache } =
  await import(
    new URL('../clickhouse-client.ts?test=client', import.meta.url).href
  )
// Import connection-pool to clear between tests
const { clientPool, cleanupStaleClients, getPoolKey } = await import(
  new URL('../connection-pool.ts?test=client', import.meta.url).href
)

describe('getClient', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123'
    process.env.CLICKHOUSE_USER = 'default'
    process.env.CLICKHOUSE_PASSWORD = ''
    _resetEnvCache()
    clientPool.clear()
    mockCreateClient.mockReset()
    mockCreateClientWeb.mockReset()
    mockIsCloudflareWorkers.mockReset()
    mockIsCloudflareWorkers.mockReturnValue(false)
  })

  afterAll(() => {
    process.env = originalEnv
    mock.restore()
  })

  it('creates a standard client when web: false', async () => {
    const fakeClient = { query: mock(() => {}) }
    mockCreateClient.mockReturnValue(fakeClient)

    const client = await getClient({ web: false })

    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:8123',
        username: 'default',
        password: '',
      })
    )
    expect(mockCreateClientWeb).not.toHaveBeenCalled()
    expect(client).toBe(fakeClient)
  })

  it('creates a web client when web: true', async () => {
    const fakeClient = { query: mock(() => {}) }
    mockCreateClientWeb.mockReturnValue(fakeClient)

    const client = await getClient({ web: true })

    expect(mockCreateClientWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:8123',
        username: 'default',
        password: '',
      })
    )
    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(client).toBe(fakeClient)
  })

  it('defaults to web client when no web flag is provided', async () => {
    // getClient() defaults to web (web !== false) regardless of runtime.
    // isCloudflareWorkers() is no longer consulted.
    const fakeClient = { query: mock(() => {}) }
    mockCreateClientWeb.mockReturnValue(fakeClient)

    const client = await getClient({}) // no web flag

    expect(mockIsCloudflareWorkers).not.toHaveBeenCalled()
    expect(mockCreateClientWeb).toHaveBeenCalled()
    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(client).toBe(fakeClient)
  })

  it('defaults to web client even when isCloudflareWorkers would return false', async () => {
    // Docker/k8s regression: previously defaulted to node client when
    // isCloudflareWorkers() returned false, which hit the empty.ts stub.
    mockIsCloudflareWorkers.mockReturnValue(false)
    const fakeClient = { query: mock(() => {}) }
    mockCreateClientWeb.mockReturnValue(fakeClient)

    const client = await getClient({})

    expect(mockCreateClientWeb).toHaveBeenCalled()
    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(client).toBe(fakeClient)
  })

  it('passes max_execution_time from env', async () => {
    process.env.CLICKHOUSE_MAX_EXECUTION_TIME = '120'
    _resetEnvCache()
    mockCreateClient.mockReturnValue({})

    await getClient({ web: false })

    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clickhouse_settings: expect.objectContaining({
          max_execution_time: 120,
        }),
      })
    )
  })

  it('merges custom clickhouseSettings', async () => {
    mockCreateClient.mockReturnValue({})

    await getClient({
      web: false,
      clickhouseSettings: { custom_setting: 'value' },
    })

    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        clickhouse_settings: expect.objectContaining({
          max_execution_time: 60,
          custom_setting: 'value',
        }),
      })
    )
  })

  it('accepts explicit clientConfig instead of using env', async () => {
    const fakeClient = { query: mock(() => {}) }
    mockCreateClient.mockReturnValue(fakeClient)

    const customConfig = {
      id: 99,
      host: 'http://custom-host:8123',
      user: 'custom_user',
      password: 'custom_pw',
    }

    const client = await getClient({ clientConfig: customConfig, web: false })

    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://custom-host:8123',
        username: 'custom_user',
        password: 'custom_pw',
      })
    )
    expect(client).toBe(fakeClient)
  })

  it('reuses pooled client on second call with same config', async () => {
    const fakeClient = { query: mock(() => {}) }
    mockCreateClient.mockReturnValue(fakeClient)

    const client1 = await getClient({ web: false })
    const client2 = await getClient({ web: false })

    // Should only create one client
    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    expect(client1).toBe(client2)
  })

  // Regression coverage for issue #2945: the pool key used to ignore the
  // password, so a long-lived process kept querying with the OLD credentials
  // after a CLICKHOUSE_PASSWORD rotation.
  it('creates a fresh client after a password rotation instead of reusing the old one', async () => {
    // A distinct client object per createClient() call, so identity tells us
    // whether the pool handed back the stale one.
    mockCreateClient.mockImplementation(() => ({ query: mock(() => {}) }))

    process.env.CLICKHOUSE_PASSWORD = 'old_pw'
    _resetEnvCache()
    const beforeRotation = await getClient({ web: false })

    process.env.CLICKHOUSE_PASSWORD = 'rotated_pw'
    _resetEnvCache()
    const afterRotation = await getClient({ web: false })

    expect(afterRotation).not.toBe(beforeRotation)
    expect(mockCreateClient).toHaveBeenCalledTimes(2)
    expect(mockCreateClient).toHaveBeenLastCalledWith(
      expect.objectContaining({ password: 'rotated_pw' })
    )
  })

  it('creates separate clients for web and non-web', async () => {
    mockCreateClient.mockReturnValue({ query: () => {} })
    mockCreateClientWeb.mockReturnValue({ query: () => {} })

    await getClient({ web: false })
    await getClient({ web: true })

    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    expect(mockCreateClientWeb).toHaveBeenCalledTimes(1)
    expect(clientPool.size).toBe(2)
  })

  it('accepts hostId and resolves config', async () => {
    process.env.CLICKHOUSE_HOST = 'host1,host2'
    process.env.CLICKHOUSE_USER = 'u1,u2'
    process.env.CLICKHOUSE_PASSWORD = 'p1,p2'
    _resetEnvCache()

    mockCreateClient.mockReturnValue({})

    await getClient({ hostId: 1, web: false })

    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'host2',
        username: 'u2',
        password: 'p2',
      })
    )
  })
})

describe('isCloudflareWorkers re-export', () => {
  it('is re-exported from the module', () => {
    expect(typeof isCloudflareWorkers).toBe('function')
  })
})

describe('releaseClient', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123,host2'
    process.env.CLICKHOUSE_USER = 'default,u2'
    process.env.CLICKHOUSE_PASSWORD = ',p2'
    _resetEnvCache()
    clientPool.clear()
    mockCreateClient.mockReset()
    mockCreateClientWeb.mockReset()
    mockIsCloudflareWorkers.mockReset()
    mockIsCloudflareWorkers.mockReturnValue(false)
  })

  afterAll(() => {
    process.env = originalEnv
    mock.restore()
  })

  it('correctly releases leased clients and clamps to 0', async () => {
    mockCreateClient.mockReturnValue({})
    await getClient({ web: false })

    // CLICKHOUSE_PASSWORD=',p2' → host 0 has an empty password (#2947).
    const key = getPoolKey(
      { id: 0, host: 'http://localhost:8123', user: 'default', password: '' },
      false
    )
    const pooled = clientPool.get(key)
    expect(pooled).toBeDefined()
    expect(pooled?.inUse).toBe(1)

    releaseClient({ web: false })
    expect(pooled?.inUse).toBe(0)

    // Clamp to 0
    releaseClient({ web: false })
    expect(pooled?.inUse).toBe(0)
  })

  it('correctly resolves clientConfig or hostId', async () => {
    mockCreateClient.mockReturnValue({})
    await getClient({ hostId: 1, web: false })

    const key = getPoolKey(
      { id: 1, host: 'host2', user: 'u2', password: 'p2' },
      false
    )
    const pooled = clientPool.get(key)
    expect(pooled).toBeDefined()
    expect(pooled?.inUse).toBe(1)

    releaseClient({ hostId: 1, web: false })
    expect(pooled?.inUse).toBe(0)
  })

  it('cleans up client via cleanupStaleClients only when not in use', async () => {
    mockCreateClient.mockReturnValue({})
    await getClient({ web: false })

    const key = getPoolKey(
      { id: 0, host: 'http://localhost:8123', user: 'default', password: '' },
      false
    )
    const pooled = clientPool.get(key)
    expect(pooled).toBeDefined()

    // Simulate idle timeout
    pooled!.lastUsed = Date.now() - 600_000

    // Should not clean up since it's in use
    cleanupStaleClients()
    expect(clientPool.has(key)).toBe(true)

    // Release the client
    releaseClient({ web: false })

    // Simulate idle timeout again after release (since releaseClient resets lastUsed)
    pooled!.lastUsed = Date.now() - 600_000

    // Now it should clean up
    cleanupStaleClients()
    expect(clientPool.has(key)).toBe(false)
  })
})
