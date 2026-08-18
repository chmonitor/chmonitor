import {
  CHART_FRESHNESS,
  chartCachePolicy,
  chartRefreshInterval,
} from './chart-freshness'
import { REFRESH_INTERVAL } from './config'
import { describe, expect, test } from 'bun:test'
import {
  cachePolicyToQueryCacheTtlSeconds,
  getChartQuery,
  hasChart,
} from '@/lib/api/chart-registry'

describe('CHART_FRESHNESS (#2992 / #3005 item 3)', () => {
  test('live process/metrics tiles stay fast and realtime-cached', () => {
    expect(CHART_FRESHNESS['running-queries-count']).toEqual({
      refreshInterval: REFRESH_INTERVAL.FAST_15S,
      cachePolicy: 'realtime',
    })
    expect(CHART_FRESHNESS['insight-active-queries'].cachePolicy).toBe(
      'realtime'
    )
    expect(CHART_FRESHNESS['insight-current-memory'].cachePolicy).toBe(
      'realtime'
    )
    expect(CHART_FRESHNESS['insight-http-connections'].cachePolicy).toBe(
      'realtime'
    )
    expect(CHART_FRESHNESS['insight-active-queries'].refreshInterval).toBe(
      REFRESH_INTERVAL.DEFAULT_60S
    )
  })

  test('slow-moving charts poll at 2m or 5m with historical cache', () => {
    const slow = [
      'query-count-heatmap',
      'top-table-size',
      'query-count-by-user',
      'query-count',
      'query-duration',
      'disks-usage',
      'disk-io-throughput',
      'new-parts-created',
      'insight-total-storage',
      'insight-busiest-day-queries',
    ] as const

    for (const name of slow) {
      const entry = CHART_FRESHNESS[name]
      expect(
        entry.refreshInterval === REFRESH_INTERVAL.SLOW_2M ||
          entry.refreshInterval === REFRESH_INTERVAL.VERY_SLOW_5M
      ).toBe(true)
      expect(entry.cachePolicy).toBe('historical')
    }
  })

  test('day-granularity and multi-year windows use VERY_SLOW_5M', () => {
    expect(CHART_FRESHNESS['query-count-heatmap'].refreshInterval).toBe(
      REFRESH_INTERVAL.VERY_SLOW_5M
    )
    expect(CHART_FRESHNESS['query-duration'].refreshInterval).toBe(
      REFRESH_INTERVAL.VERY_SLOW_5M
    )
    expect(CHART_FRESHNESS['disks-usage'].refreshInterval).toBe(
      REFRESH_INTERVAL.VERY_SLOW_5M
    )
    expect(CHART_FRESHNESS['insight-busiest-day-queries'].refreshInterval).toBe(
      REFRESH_INTERVAL.VERY_SLOW_5M
    )
  })

  test('table sizes and hourly aggregates use SLOW_2M, not the 30s live bucket', () => {
    expect(CHART_FRESHNESS['top-table-size'].refreshInterval).toBe(
      REFRESH_INTERVAL.SLOW_2M
    )
    expect(CHART_FRESHNESS['query-count-by-user'].refreshInterval).toBe(
      REFRESH_INTERVAL.SLOW_2M
    )
    expect(CHART_FRESHNESS['disk-io-throughput'].refreshInterval).toBe(
      REFRESH_INTERVAL.SLOW_2M
    )
    expect(CHART_FRESHNESS['new-parts-created'].refreshInterval).toBe(
      REFRESH_INTERVAL.SLOW_2M
    )
  })

  test('helpers return undefined for unaudited charts', () => {
    expect(chartRefreshInterval('cpu-usage')).toBeUndefined()
    expect(chartCachePolicy('cpu-usage')).toBeUndefined()
    expect(chartRefreshInterval('memory-usage')).toBeUndefined()
    expect(chartCachePolicy('not-a-chart')).toBeUndefined()
  })

  test('every freshness entry names a registered chart', () => {
    const missing = Object.keys(CHART_FRESHNESS).filter(
      (name) => !hasChart(name)
    )
    expect(missing).toEqual([])
  })

  test('getChartQuery applies cachePolicy from the freshness map', () => {
    const heatmap = getChartQuery('query-count-heatmap')
    expect(heatmap?.cachePolicy).toBe('historical')
    expect(cachePolicyToQueryCacheTtlSeconds(heatmap?.cachePolicy)).toBe(120)

    const running = getChartQuery('running-queries-count')
    expect(running?.cachePolicy).toBe('realtime')
    expect(cachePolicyToQueryCacheTtlSeconds(running?.cachePolicy)).toBe(10)

    const liveInsight = getChartQuery('insight-active-queries')
    expect(liveInsight?.cachePolicy).toBe('realtime')

    const storage = getChartQuery('top-table-size')
    expect(storage?.cachePolicy).toBe('historical')
  })

  test('unaudited charts stay on the standard 30s cache bucket', () => {
    const cpu = getChartQuery('cpu-usage')
    expect(cpu?.cachePolicy).toBeUndefined()
    expect(cachePolicyToQueryCacheTtlSeconds(cpu?.cachePolicy)).toBe(30)
  })

  test('no chart is both realtime-cached and slower than 60s', () => {
    for (const [name, entry] of Object.entries(CHART_FRESHNESS)) {
      if (entry.cachePolicy === 'realtime') {
        expect(entry.refreshInterval).toBeLessThanOrEqual(
          REFRESH_INTERVAL.DEFAULT_60S
        )
      }
      if (entry.cachePolicy === 'historical') {
        expect(entry.refreshInterval).toBeGreaterThanOrEqual(
          REFRESH_INTERVAL.SLOW_2M
        )
      }
      expect(name.length).toBeGreaterThan(0)
    }
  })
})
