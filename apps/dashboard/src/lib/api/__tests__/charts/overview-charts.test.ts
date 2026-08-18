import { describe, expect, test } from 'bun:test'
import { overviewCharts } from '@/lib/api/charts/overview-charts'

describe('overview-charts', () => {
  const entries = Object.entries(overviewCharts)

  test('is non-empty', () => {
    expect(entries.length).toBeGreaterThanOrEqual(5)
  })

  test.each(entries)('%s returns a query', (_name, builder) => {
    const result = builder({}) as any
    expect(result).toBeDefined()
    expect(result.query).toContain('SELECT')
  })

  test('running-queries-count counts processes', () => {
    const result = overviewCharts['running-queries-count']!({}) as any
    expect(result.query).toContain('system.processes')
    expect(result.query).toContain('COUNT')
  })

  test('running-queries-count is realtime-cached via the freshness map', async () => {
    const { getChartQuery } = await import('@/lib/api/chart-registry')
    expect(getChartQuery('running-queries-count')?.cachePolicy).toBe('realtime')
  })

  test('database-count excludes system databases', () => {
    const result = overviewCharts['database-count']!({}) as any
    expect(result.query).toContain('system.tables')
    expect(result.query).toContain('information_schema')
  })

  test('disk-size-single returns disk metrics', () => {
    const result = overviewCharts['disk-size-single']!({}) as any
    expect(result.query).toContain('system.disks')
    expect(result.query).toContain('formatReadableSize')
    expect(result.query).toContain('LIMIT 1')
  })

  test('disk-size-all returns every disk with type and free space', () => {
    const result = overviewCharts['disk-size-all']!({}) as any
    expect(result.query).toContain('system.disks')
    expect(result.query).toContain('formatReadableSize')
    // Multi-disk breakdown: must NOT cap to a single disk like disk-size-single.
    expect(result.query).not.toContain('LIMIT')
    // Drives the per-disk type badge and the "free" figures in the card.
    expect(result.query).toContain('type')
    expect(result.query).toContain('free_space')
  })

  test('table-count counts unique tables', () => {
    const result = overviewCharts['table-count']!({}) as any
    expect(result.query).toContain('countDistinct')
  })
})
