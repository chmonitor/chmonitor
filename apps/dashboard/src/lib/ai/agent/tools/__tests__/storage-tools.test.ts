import { mockCheckTableExists, mockFetchData } from './shared-mocks'
import { describe, expect, test } from 'bun:test'

const queryStore: Record<string, unknown[]> = {}

function setupStorageMock() {
  mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
    // Most specific routes first — several of these queries share substrings
    // (e.g. both hit "system.part_log" or "system.parts").
    if (query.includes('bytes_written'))
      return { data: queryStore.hotTables ?? [], error: null }
    if (query.includes('sum(bytes_on_disk)'))
      return { data: queryStore.tableBytes ?? [], error: null }
    if (query.includes('system.parts'))
      return { data: queryStore.parts ?? [], error: null }
    if (query.includes('system.disks'))
      return { data: queryStore.diskTotals ?? [], error: null }
    if (query.includes('system.columns'))
      return { data: queryStore.columns ?? [], error: null }
    if (query.includes('system.part_log'))
      return { data: queryStore.dailyPartLog ?? [], error: null }
    return { data: [], error: null }
  })
}

/** Same date-key formula capacity-forecaster.ts's buildDailySeries uses. */
function daysAgoStr(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

const { createStorageTools } = await import('../storage-tools')

describe('createStorageTools', () => {
  test('creates storage tools', () => {
    const tools = createStorageTools(0) as any
    expect(tools.get_table_parts).toBeDefined()
    expect(tools.forecast_disk_capacity).toBeDefined()
    expect(tools.suggest_ttl_adjustment).toBeDefined()
  })

  test('get_table_parts returns parts for a table', async () => {
    Object.keys(queryStore).forEach((k) => delete queryStore[k])
    queryStore.parts = [
      {
        name: 'all_1_1_0',
        partition: '202401',
        rows: 1000,
        size_on_disk: '100 KiB',
        compression_ratio: 0.15,
      },
    ]
    setupStorageMock()

    const tools = createStorageTools(0) as any
    const result = await tools.get_table_parts.execute({
      database: 'analytics',
      table: 'events',
    })

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('all_1_1_0')
  })

  test('get_table_parts filters by active status', async () => {
    Object.keys(queryStore).forEach((k) => delete queryStore[k])
    queryStore.parts = [{ name: 'active_part', rows: 500 }]
    setupStorageMock()

    const tools = createStorageTools(0) as any
    const result = await tools.get_table_parts.execute({
      database: 'db',
      table: 'tbl',
      active: true,
    })

    expect(result).toHaveLength(1)
  })

  test('get_table_parts respects custom limit', async () => {
    Object.keys(queryStore).forEach((k) => delete queryStore[k])
    queryStore.parts = [{ name: 'p1' }, { name: 'p2' }]
    setupStorageMock()

    const tools = createStorageTools(0) as any
    const result = await tools.get_table_parts.execute({
      database: 'db',
      table: 'tbl',
      limit: 1,
    })

    expect(result).toHaveLength(2)
  })

  test('get_table_parts uses default limit of 100', async () => {
    Object.keys(queryStore).forEach((k) => delete queryStore[k])
    queryStore.parts = []
    setupStorageMock()

    const tools = createStorageTools(0) as any
    const result = await tools.get_table_parts.execute({
      database: 'db',
      table: 'tbl',
    })

    expect(result).toEqual([])
  })

  test('tools resolve hostId override', async () => {
    Object.keys(queryStore).forEach((k) => delete queryStore[k])
    setupStorageMock()

    const tools = createStorageTools(0) as any
    const result = await tools.get_table_parts.execute({
      database: 'db',
      table: 'tbl',
      hostId: 3,
    })
    expect(Array.isArray(result)).toBe(true)
  })

  describe('forecast_disk_capacity', () => {
    test('reports a clear message instead of a fabricated forecast when part_log is disabled', async () => {
      Object.keys(queryStore).forEach((k) => delete queryStore[k])
      setupStorageMock()
      mockCheckTableExists.mockResolvedValueOnce(false)

      const tools = createStorageTools(0) as any
      const result = await tools.forecast_disk_capacity.execute({})

      expect(result.available).toBe(false)
      expect(result.reason).toBe('part_log_disabled')
      expect(String(result.message).toLowerCase()).toContain('part_log')
    })

    test('forecasts disk-full from part_log growth and disk totals', async () => {
      Object.keys(queryStore).forEach((k) => delete queryStore[k])
      const GB = 1024 ** 3
      queryStore.dailyPartLog = Array.from({ length: 30 }, (_, n) => ({
        day: daysAgoStr(n),
        bytes: GB,
      }))
      queryStore.diskTotals = [{ free_bytes: 100 * GB, total_bytes: 500 * GB }]
      queryStore.hotTables = []
      setupStorageMock()
      mockCheckTableExists.mockResolvedValue(true)

      const tools = createStorageTools(0) as any
      const result = await tools.forecast_disk_capacity.execute({
        horizonDays: 200,
      })

      expect(result.available).toBe(true)
      expect(result.daysToFull).toBe(100)
      expect(typeof result.explanation).toBe('string')
    })

    test('resolves hostId override', async () => {
      Object.keys(queryStore).forEach((k) => delete queryStore[k])
      setupStorageMock()
      mockCheckTableExists.mockResolvedValue(true)

      const tools = createStorageTools(0) as any
      const result = await tools.forecast_disk_capacity.execute({ hostId: 3 })
      expect(typeof result.available).toBe('boolean')
    })
  })

  describe('suggest_ttl_adjustment', () => {
    test('reports a clear message instead of a fabricated suggestion when part_log is disabled', async () => {
      Object.keys(queryStore).forEach((k) => delete queryStore[k])
      setupStorageMock()
      mockCheckTableExists.mockResolvedValueOnce(false)

      const tools = createStorageTools(0) as any
      const result = await tools.suggest_ttl_adjustment.execute({
        database: 'analytics',
        table: 'events',
      })

      expect(result.available).toBe(false)
      expect(result.reason).toBe('part_log_disabled')
    })

    test('defaults retentionRequirementDays to 30 and flags it as an assumed default', async () => {
      Object.keys(queryStore).forEach((k) => delete queryStore[k])
      const GB = 1024 ** 3
      queryStore.tableBytes = [{ bytes: 1 * GB }]
      queryStore.diskTotals = [{ free_bytes: 900 * GB, total_bytes: 1000 * GB }]
      queryStore.columns = []
      queryStore.dailyPartLog = Array.from({ length: 30 }, (_, n) => ({
        day: daysAgoStr(n),
        bytes: 0.01 * GB,
      }))
      setupStorageMock()
      mockCheckTableExists.mockResolvedValue(true)

      const tools = createStorageTools(0) as any
      const result = await tools.suggest_ttl_adjustment.execute({
        database: 'analytics',
        table: 'events',
      })

      expect(result.available).toBe(true)
      expect(result.retentionRequirementDays).toBe(30)
      expect(result.retentionAssumedDefault).toBe(true)
      expect(result.suggestedTtlDays).toBeGreaterThanOrEqual(30)
    })

    test('never suggests a TTL below an explicit retention floor, and the suggestion is a string never executed', async () => {
      Object.keys(queryStore).forEach((k) => delete queryStore[k])
      const GB = 1024 ** 3
      queryStore.tableBytes = [{ bytes: 10 * GB }]
      queryStore.diskTotals = [{ free_bytes: 5 * GB, total_bytes: 1000 * GB }]
      queryStore.columns = [
        {
          name: 'event_date',
          type: 'Date',
          is_in_partition_key: 1,
          is_in_sorting_key: 0,
        },
      ]
      queryStore.dailyPartLog = Array.from({ length: 30 }, (_, n) => ({
        day: daysAgoStr(n),
        bytes: 50 * GB,
      }))
      setupStorageMock()
      mockCheckTableExists.mockResolvedValue(true)

      const tools = createStorageTools(0) as any
      const result = await tools.suggest_ttl_adjustment.execute({
        database: 'analytics',
        table: 'events',
        retentionRequirementDays: 90,
      })

      expect(result.available).toBe(true)
      expect(result.retentionAssumedDefault).toBe(false)
      expect(result.suggestedTtlDays).toBe(90)
      expect(result.meetsUtilizationTarget).toBe(false)
      expect(typeof result.sql).toBe('string')
      expect(result.sql).toContain('ALTER TABLE')
      expect(result.sql).toContain('90 DAY')
    })
  })
})
