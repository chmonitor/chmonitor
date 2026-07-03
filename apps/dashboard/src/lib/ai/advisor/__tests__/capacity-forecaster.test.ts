// @ts-nocheck — test file, only runs under bun:test
import { describe, expect, mock, test } from 'bun:test'

// bun test runs with --isolate (see apps/dashboard/package.json), so
// mock.module() here is scoped to this file's process and cannot leak into
// or collide with apps/dashboard/src/lib/ai/agent/tools/__tests__/shared-mocks.ts.
const mockFetchData = mock(
  async (_params: { query: string; hostId?: number }) => ({
    data: [] as any[],
    error: null,
  })
) as any
mock.module('@chm/clickhouse-client', () => ({ fetchData: mockFetchData }))

// Defaults to "table exists" — tests exercising the disabled path override
// with mockCheckTableExists.mockResolvedValueOnce(false).
const mockCheckTableExists = mock(async () => true) as any
mock.module('@chm/clickhouse-client/table-existence-cache', () => ({
  checkTableExists: mockCheckTableExists,
}))

const {
  buildDailySeries,
  fitLinearGrowth,
  growthConfidence,
  computeTtlSuggestion,
  forecastDiskFull,
  identifyHotTables,
  suggestTtl,
} = await import('../capacity-forecaster')

const GB = 1024 ** 3

/** Same date-key formula buildDailySeries uses internally, for building mock part_log rows. */
function daysAgoStr(n: number, ref: Date = new Date()): string {
  const d = new Date(ref)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

describe('buildDailySeries', () => {
  test('fills a dense window in chronological order, defaulting missing days to 0', () => {
    const ref = new Date('2026-07-03T12:00:00.000Z')
    const rows = [
      { day: '2026-07-01', bytes: 100 },
      { day: '2026-07-03', bytes: 300 },
    ]
    const series = buildDailySeries(rows, 3, ref)
    // index 0 = 2 days ago (07-01), 1 = yesterday (07-02, missing -> 0), 2 = today (07-03)
    expect(series).toEqual([100, 0, 300])
  })

  test('returns all zeros when there are no rows', () => {
    expect(buildDailySeries([], 5, new Date('2026-07-03'))).toEqual([
      0, 0, 0, 0, 0,
    ])
  })
})

describe('fitLinearGrowth', () => {
  test('recovers the exact slope for a perfectly steady daily rate', () => {
    const { slope, intercept } = fitLinearGrowth(Array(10).fill(1000))
    expect(slope).toBeCloseTo(1000, 6)
    expect(intercept).toBeGreaterThan(0) // cumulative series starts above zero
  })

  test('zero daily bytes (no ingestion at all) yields zero slope', () => {
    const { slope } = fitLinearGrowth(Array(15).fill(0))
    expect(slope).toBe(0)
  })

  test('empty series is degenerate but safe (never throws/NaNs)', () => {
    expect(fitLinearGrowth([])).toEqual({ slope: 0, intercept: 0 })
  })

  test('estimates the daily growth rate within 15% tolerance for noisy data', () => {
    const base = 1_000_000
    // deterministic +/-10% noise around a steady base rate
    const noiseFactors = [
      0.95, 1.05, 0.9, 1.1, 1.0, 0.92, 1.08, 0.97, 1.03, 0.94, 1.06, 1.01, 0.98,
      1.02, 0.96,
    ]
    const daily = noiseFactors.map((f) => Math.round(base * f))
    const { slope } = fitLinearGrowth(daily)
    const relativeError = Math.abs(slope - base) / base
    expect(relativeError).toBeLessThan(0.15)
  })

  test('picks up an accelerating trend (slope reflects the recent, faster rate more than a flat average would)', () => {
    // Growth doubles partway through the window.
    const daily = [...Array(10).fill(500_000), ...Array(10).fill(1_000_000)]
    const flatAverage = daily.reduce((a, b) => a + b, 0) / daily.length // 750,000
    const { slope } = fitLinearGrowth(daily)
    expect(slope).toBeGreaterThan(flatAverage)
  })
})

describe('growthConfidence', () => {
  test('low confidence with fewer than 7 days of history', () => {
    expect(growthConfidence([1000, 1000, 1000])).toBe('low')
  })

  test('low confidence when there is no measurable growth', () => {
    expect(growthConfidence(Array(10).fill(0))).toBe('low')
  })

  test('high confidence for steady, low-dispersion daily growth', () => {
    const daily = [980, 1010, 995, 1005, 1000, 990, 1015, 1002, 998, 1003]
    expect(growthConfidence(daily)).toBe('high')
  })

  test('low confidence for bursty daily growth despite a near-linear cumulative trend', () => {
    // Mostly-zero with rare huge spikes: the cumulative sum still trends
    // upward, but day-to-day behavior is unpredictable — confidence must come
    // from the daily dispersion, not the cumulative fit's goodness.
    const daily = [0, 0, 50_000, 0, 0, 0, 45_000, 0, 0, 0, 52_000, 0]
    expect(growthConfidence(daily)).toBe('low')
  })
})

describe('computeTtlSuggestion', () => {
  test('suggests the largest safe TTL when there is disk headroom', () => {
    const result = computeTtlSuggestion({
      currentBytes: 10 * GB,
      dailyGrowthBytes: 1 * GB,
      freeBytes: 500 * GB,
      totalBytes: 1000 * GB,
      retentionDays: 30,
    })
    // other used = 1000 - 500 - 10 = 490 GB; target = 800 GB; headroom = 310 GB / 1 GB/day
    expect(result.nSafeDays).toBe(310)
    expect(result.suggestedTtlDays).toBe(310)
    expect(result.meetsUtilizationTarget).toBe(true)
  })

  test('never suggests a TTL below the retention floor, even under severe disk pressure', () => {
    const result = computeTtlSuggestion({
      currentBytes: 10 * GB,
      dailyGrowthBytes: 50 * GB,
      freeBytes: 5 * GB,
      totalBytes: 1000 * GB,
      retentionDays: 30,
    })
    expect(result.nSafeDays).toBe(0)
    expect(result.suggestedTtlDays).toBe(30)
    expect(result.meetsUtilizationTarget).toBe(false)
    expect(result.riskNote).toContain('30-day retention floor')
  })

  test('a table that is not growing suggests exactly the retention floor', () => {
    const result = computeTtlSuggestion({
      currentBytes: 10 * GB,
      dailyGrowthBytes: 0,
      freeBytes: 100 * GB,
      totalBytes: 1000 * GB,
      retentionDays: 45,
    })
    expect(result.nSafeDays).toBeNull()
    expect(result.suggestedTtlDays).toBe(45)
    expect(result.meetsUtilizationTarget).toBe(true)
  })

  test('growth so slow it would take >100 years to matter collapses to the retention floor, not an absurd interval', () => {
    const result = computeTtlSuggestion({
      currentBytes: 1 * GB,
      dailyGrowthBytes: 1, // 1 byte/day
      freeBytes: 900 * GB,
      totalBytes: 1000 * GB,
      retentionDays: 30,
    })
    // Without the >100y cap this would be hundreds of billions of days.
    expect(result.nSafeDays).toBeNull()
    expect(result.suggestedTtlDays).toBe(30)
    expect(result.meetsUtilizationTarget).toBe(true)
  })

  test('fuzz: suggestedTtlDays is never below retentionDays, and never an absurd interval, across randomized inputs', () => {
    for (let i = 0; i < 500; i++) {
      const totalBytes = Math.random() * 1000 * GB + GB
      const freeBytes = Math.random() * totalBytes
      const currentBytes = Math.random() * Math.max(totalBytes - freeBytes, 1)
      // Occasionally drive dailyGrowthBytes down near zero (but still
      // positive) to exercise the "effectively never" cap, in addition to
      // the normal 0..10GB range.
      const dailyGrowthBytes =
        i % 10 === 0 ? Math.random() * 0.001 : Math.random() * 10 * GB
      const retentionDays = Math.floor(Math.random() * 365) + 1

      const result = computeTtlSuggestion({
        currentBytes,
        dailyGrowthBytes,
        freeBytes,
        totalBytes,
        retentionDays,
      })

      expect(result.suggestedTtlDays).toBeGreaterThanOrEqual(retentionDays)
      expect(result.suggestedTtlDays).toBeLessThanOrEqual(36_500)
    }
  })
})

describe('forecastDiskFull', () => {
  test('returns available: false with a clear message when part_log is disabled (never fabricates a forecast)', async () => {
    mockCheckTableExists.mockResolvedValueOnce(false)
    const result = await forecastDiskFull(0)
    expect(result.available).toBe(false)
    if (!result.available) {
      expect(result.reason).toBe('part_log_disabled')
      expect(result.message.toLowerCase()).toContain('part_log')
    }
  })

  test('forecasts a disk-full date from a steady growth trend', async () => {
    mockCheckTableExists.mockResolvedValue(true)
    const dailyRows = Array.from({ length: 30 }, (_, n) => ({
      day: daysAgoStr(n),
      bytes: GB,
    }))
    mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes('bytes_written')) return { data: [], error: null }
      if (query.includes('system.disks'))
        return {
          data: [{ free_bytes: 100 * GB, total_bytes: 500 * GB }],
          error: null,
        }
      if (query.includes('system.part_log'))
        return { data: dailyRows, error: null }
      return { data: [], error: null }
    })

    const result = await forecastDiskFull(0, 200)
    expect(result.available).toBe(true)
    if (result.available) {
      expect(Math.abs(result.dailyGrowthBytes - GB) / GB).toBeLessThan(0.01)
      expect(result.daysToFull).toBe(100) // 100 GiB free / ~1 GiB per day
      expect(result.confidence).toBe('high')
      expect(result.willExceedHorizon).toBe(true)
    }
  })

  test('does not crash (Date overflow) when growth is tiny relative to a huge amount of free space', async () => {
    mockCheckTableExists.mockResolvedValue(true)
    // ~100 bytes/day against 1 TB free: naive daysToFull would be in the
    // billions, and Date.now() + that many days overflows JS's representable
    // date range, throwing a RangeError out of toISOString() if uncapped.
    const dailyRows = Array.from({ length: 30 }, (_, n) => ({
      day: daysAgoStr(n),
      bytes: 100,
    }))
    mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes('bytes_written')) return { data: [], error: null }
      if (query.includes('system.disks'))
        return {
          data: [{ free_bytes: 1024 * GB, total_bytes: 2048 * GB }],
          error: null,
        }
      if (query.includes('system.part_log'))
        return { data: dailyRows, error: null }
      return { data: [], error: null }
    })

    const result = await forecastDiskFull(0)
    expect(result.available).toBe(true)
    if (result.available) {
      expect(result.daysToFull).toBeNull()
      expect(result.fullDate).toBeNull()
      expect(result.willExceedHorizon).toBe(false)
      expect(typeof result.explanation).toBe('string')
    }
  })

  test('a hot-tables lookup failure does not sink the overall forecast (best-effort enrichment)', async () => {
    mockCheckTableExists.mockResolvedValue(true)
    let call = 0
    mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
      call++
      if (query.includes('bytes_written')) throw new Error('boom')
      if (query.includes('system.disks'))
        return {
          data: [{ free_bytes: 10 * GB, total_bytes: 100 * GB }],
          error: null,
        }
      if (query.includes('system.part_log'))
        return { data: [{ day: daysAgoStr(0), bytes: GB }], error: null }
      return { data: [], error: null }
    })

    const result = await forecastDiskFull(0)
    expect(result.available).toBe(true)
    if (result.available) {
      expect(result.topContributors).toEqual([])
    }
    expect(call).toBeGreaterThan(0)
  })
})

describe('identifyHotTables', () => {
  test('returns available: false when part_log is disabled', async () => {
    mockCheckTableExists.mockResolvedValueOnce(false)
    const result = await identifyHotTables(0)
    expect(result.available).toBe(false)
  })

  test('ranks tables by NewPart bytes written, descending', async () => {
    mockCheckTableExists.mockResolvedValue(true)
    mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes('bytes_written'))
        return {
          data: [
            {
              database: 'analytics',
              table: 'events',
              bytes_written: 500_000_000,
            },
            {
              database: 'analytics',
              table: 'sessions',
              bytes_written: 100_000_000,
            },
          ],
          error: null,
        }
      return { data: [], error: null }
    })

    const result = await identifyHotTables(0, 5)
    expect(result.available).toBe(true)
    if (result.available) {
      expect(result.tables).toHaveLength(2)
      expect(result.tables[0].fullTable).toBe('analytics.events')
      expect(result.tables[0].bytesWritten).toBe(500_000_000)
    }
  })
})

describe('suggestTtl', () => {
  test('returns available: false with a clear message when part_log is disabled', async () => {
    mockCheckTableExists.mockResolvedValueOnce(false)
    const result = await suggestTtl({
      hostId: 0,
      database: 'db',
      table: 'tbl',
      retentionDays: 30,
    })
    expect(result.available).toBe(false)
    if (!result.available) expect(result.reason).toBe('part_log_disabled')
  })

  test('end-to-end: never suggests below the retention floor, and flags the risk when it cannot meet the utilization target', async () => {
    mockCheckTableExists.mockResolvedValue(true)
    const dailyRows = Array.from({ length: 30 }, (_, n) => ({
      day: daysAgoStr(n),
      bytes: 50 * GB, // aggressive growth
    }))
    mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes('sum(bytes_on_disk)'))
        return { data: [{ bytes: 10 * GB }], error: null }
      if (query.includes('system.disks'))
        return {
          data: [{ free_bytes: 5 * GB, total_bytes: 1000 * GB }],
          error: null,
        }
      if (query.includes('system.columns'))
        return {
          data: [
            {
              name: 'event_date',
              type: 'Date',
              is_in_partition_key: 1,
              is_in_sorting_key: 0,
            },
          ],
          error: null,
        }
      if (query.includes('system.part_log'))
        return { data: dailyRows, error: null }
      return { data: [], error: null }
    })

    const result = await suggestTtl({
      hostId: 0,
      database: 'analytics',
      table: 'events',
      retentionDays: 30,
    })

    expect(result.available).toBe(true)
    if (result.available) {
      expect(result.suggestedTtlDays).toBe(30)
      expect(result.meetsUtilizationTarget).toBe(false)
      expect(result.sql).toBe(
        'ALTER TABLE `analytics`.`events` MODIFY TTL event_date + INTERVAL 30 DAY'
      )
      expect(result.riskNote).toContain('retention floor')
    }
  })

  test('suggests a longer TTL with disk headroom, and never fabricates a date column it did not find', async () => {
    mockCheckTableExists.mockResolvedValue(true)
    const dailyRows = Array.from({ length: 30 }, (_, n) => ({
      day: daysAgoStr(n),
      bytes: 0.01 * GB, // slow growth
    }))
    mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes('sum(bytes_on_disk)'))
        return { data: [{ bytes: 1 * GB }], error: null }
      if (query.includes('system.disks'))
        return {
          data: [{ free_bytes: 900 * GB, total_bytes: 1000 * GB }],
          error: null,
        }
      if (query.includes('system.columns'))
        // No Date/DateTime column anywhere in the key — id is UInt64.
        return {
          data: [
            {
              name: 'id',
              type: 'UInt64',
              is_in_partition_key: 0,
              is_in_sorting_key: 1,
            },
          ],
          error: null,
        }
      if (query.includes('system.part_log'))
        return { data: dailyRows, error: null }
      return { data: [], error: null }
    })

    const result = await suggestTtl({
      hostId: 0,
      database: 'analytics',
      table: 'events',
      retentionDays: 30,
    })

    expect(result.available).toBe(true)
    if (result.available) {
      expect(result.suggestedTtlDays).toBeGreaterThanOrEqual(30)
      expect(result.meetsUtilizationTarget).toBe(true)
      expect(result.dateColumn).toBeNull()
      expect(result.sql).toContain('<date_column>')
      expect(result.sql).not.toContain('MODIFY TTL id')
    }
  })
})
