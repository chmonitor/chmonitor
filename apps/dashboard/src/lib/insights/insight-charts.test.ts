import { describe, expect, test } from 'bun:test'
import { getRegisteredChartNames } from '@/components/charts/chart-registry'
import { insightChartNames } from '@/lib/insights/insight-charts'

describe('insightChartNames', () => {
  test('maps a known metric to its specific charts', () => {
    expect(
      insightChartNames({
        category: 'reliability',
        metric: 'max_replication_delay',
      })
    ).toEqual(['replication-queue-count', 'replication-summary-table'])
    expect(
      insightChartNames({ category: 'storage', metric: 'detached_parts' })
    ).toEqual(['parts-per-table', 'new-parts-created'])
    expect(
      insightChartNames({ category: 'anomaly', metric: 'memory_usage' })
    ).toEqual(['memory-usage'])
  })

  test('metric mapping wins over category fallback', () => {
    // error_rate lives under an anomaly finding but has its own chart set,
    // which must take precedence over the generic anomaly fallback.
    expect(
      insightChartNames({ category: 'anomaly', metric: 'error_rate' })
    ).toEqual(['failed-query-count', 'query-count'])
  })

  test('falls back to category charts for an unmapped metric', () => {
    expect(
      insightChartNames({ category: 'storage', metric: 'some_new_metric' })
    ).toEqual(['top-table-size', 'disk-size'])
  })

  test('falls back to category charts for a narrative-only finding (no metric)', () => {
    expect(insightChartNames({ category: 'performance' })).toEqual([
      'query-duration-percentiles',
      'query-count',
    ])
  })

  test('returns [] for an unknown category with no metric', () => {
    expect(insightChartNames({ category: 'mystery' })).toEqual([])
  })

  test('returns [] for Postgres findings (no ClickHouse chart)', () => {
    expect(
      insightChartNames({
        category: 'reliability',
        metric: 'pg_replication_lag',
      })
    ).toEqual([])
    expect(
      insightChartNames({
        category: 'performance',
        metric: 'pg_connection_saturation',
      })
    ).toEqual([])
  })

  test('returns at most two charts', () => {
    for (const category of [
      'storage',
      'performance',
      'reliability',
      'anomaly',
    ]) {
      expect(
        insightChartNames({ category, metric: 'anything' }).length
      ).toBeLessThanOrEqual(2)
    }
  })

  test('every referenced chart key exists in the chart registry', () => {
    const registered = new Set(getRegisteredChartNames())
    const cases: Array<
      Pick<Parameters<typeof insightChartNames>[0], never> & {
        category: string
        metric?: string
      }
    > = [
      { category: 'anomaly', metric: 'error_rate' },
      { category: 'anomaly', metric: 'query_duration_p95' },
      { category: 'anomaly', metric: 'memory_usage' },
      { category: 'anomaly', metric: 'insert_throughput' },
      { category: 'storage', metric: 'disk_free_pct' },
      { category: 'storage', metric: 'max_active_parts' },
      { category: 'storage', metric: 'detached_parts' },
      { category: 'storage', metric: 'worst_compression_ratio' },
      { category: 'reliability', metric: 'readonly_replicas' },
      { category: 'reliability', metric: 'max_replication_delay' },
      { category: 'reliability', metric: 'stuck_mutations' },
      { category: 'reliability', metric: 'failed_dictionaries' },
      { category: 'performance', metric: 'longest_running_query' },
      { category: 'storage' },
      { category: 'performance' },
      { category: 'reliability' },
      { category: 'anomaly' },
      { category: 'queries' },
      { category: 'optimization' },
      { category: 'cost' },
    ]
    for (const c of cases) {
      for (const name of insightChartNames(c)) {
        expect(registered.has(name)).toBe(true)
      }
    }
  })
})
