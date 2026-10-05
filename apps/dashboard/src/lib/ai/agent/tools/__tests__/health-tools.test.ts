import { mockFetchData } from './shared-mocks'
import { describe, expect, test } from 'bun:test'

const queryStore: Record<string, unknown[]> = {}

const { createHealthTools } = await import('../health-tools')

function setupHealthMock() {
  mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
    // get_metrics reads version(), uptime(), and system.metrics in ONE query.
    // Fold the three canned stores into the single snapshot row it gets back.
    if (
      query.includes('version()') &&
      query.includes('uptime()') &&
      query.includes('system.metrics')
    )
      return {
        data: [
          {
            version: (queryStore.version ?? [])[0]?.version,
            uptime_seconds: (queryStore.uptime ?? [])[0]?.uptime_seconds,
            metric_values: (queryStore.metrics ?? []).map((row: any) => [
              row.metric,
              row.value,
            ]),
          },
        ],
        error: null,
      }
    if (query.includes('version()'))
      return { data: queryStore.version ?? [], error: null }
    if (query.includes('uptime()'))
      return { data: queryStore.uptime ?? [], error: null }
    if (query.includes('system.metrics'))
      return { data: queryStore.metrics ?? [], error: null }
    if (query.includes('system.asynchronous_metrics'))
      return { data: queryStore.async_metrics ?? [], error: null }
    if (query.includes('system.disks'))
      return { data: queryStore.disks ?? [], error: null }
    if (query.includes('system.errors'))
      return { data: queryStore.errors ?? [], error: null }
    if (query.includes('system.crash_log'))
      return { data: queryStore.crash ?? [], error: null }
    return { data: [], error: null }
  })
}

describe('createHealthTools', () => {
  test('creates health tools', () => {
    const tools = createHealthTools(0) as any
    expect(tools.get_metrics).toBeDefined()
    expect(tools.get_disk_usage).toBeDefined()
  })

  test('get_metrics returns version, uptime, and connection metrics', async () => {
    Object.keys(queryStore).forEach((k) => delete queryStore[k])
    queryStore.version = [{ version: '24.1.1' }]
    queryStore.uptime = [{ uptime_seconds: 86400 }]
    queryStore.metrics = [
      { metric: 'TCPConnection', value: 5 },
      { metric: 'HTTPConnection', value: 10 },
      { metric: 'MemoryTracking', value: 1000000 },
    ]
    setupHealthMock()

    const tools = createHealthTools(0) as any
    const result = await tools.get_metrics.execute({})

    expect(result.version).toBe('24.1.1')
    expect(result.uptime_seconds).toBe(86400)
    expect(result.TCPConnection).toBe(5)
    expect(result.HTTPConnection).toBe(10)
    expect(result.MemoryTracking).toBe(1000000)
  })

  test('get_metrics handles empty data', async () => {
    Object.keys(queryStore).forEach((k) => delete queryStore[k])
    setupHealthMock()

    const tools = createHealthTools(0) as any
    const result = await tools.get_metrics.execute({})

    expect(result.version).toBeUndefined()
    expect(result.uptime_seconds).toBeUndefined()
  })

  test('get_disk_usage returns disk data', async () => {
    Object.keys(queryStore).forEach((k) => delete queryStore[k])
    queryStore.disks = [
      {
        name: 'default',
        path: '/var/lib/clickhouse',
        free: '400 GiB',
        total: '500 GiB',
        free_pct: 80,
      },
    ]
    setupHealthMock()

    const tools = createHealthTools(0) as any
    const result = await tools.get_disk_usage.execute({})

    expect(result).toEqual([
      {
        name: 'default',
        path: '/var/lib/clickhouse',
        free: '400 GiB',
        total: '500 GiB',
        free_pct: 80,
      },
    ])
  })

  test('tools resolve hostId override', async () => {
    Object.keys(queryStore).forEach((k) => delete queryStore[k])
    setupHealthMock()

    const tools = createHealthTools(0) as any
    const result = await tools.get_disk_usage.execute({ hostId: 3 })
    expect(Array.isArray(result)).toBe(true)
  })
})
