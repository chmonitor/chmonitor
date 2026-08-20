import { describe, expect, test } from 'bun:test'
import { systemCharts } from '@/lib/api/charts/system-charts'

describe('systemCharts', () => {
  const entries = Object.entries(systemCharts)

  test('map is non-empty', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  // Regression guard for the #2898 split of system-charts.ts into
  // lib/api/charts/system/*.ts: the merged `systemCharts` map must expose
  // the exact same set of keys, in the exact same order, as before the
  // split — this is a behaviour-preserving move, not a rename/reorder.
  test('exposes the same chart keys in the same order as before the #2898 split', () => {
    expect(Object.keys(systemCharts)).toEqual([
      'memory-usage',
      'cpu-usage',
      'memory-breakdown',
      'cpu-load-average',
      'cpu-mode-split',
      'thread-pool-utilization',
      'disk-size',
      'disks-usage',
      'backup-size',
      'new-parts-created',
      'summary-used-by-running-queries',
      'summary-used-by-mutations',
      'summary-stuck-mutations',
      'disk-usage-trend',
      'disk-usage-by-database',
      'parts-per-table',
      'top-table-size',
      'mutation-progress',
      'data-freshness',
      'compression-ratio',
      'partition-part-health',
      'partition-part-health-summary',
      'oom-killed-queries',
      'top-memory-queries',
      'health-readonly-replicas',
      'health-delayed-inserts',
      'health-max-part-count',
      'health-parts-pressure',
      'health-ttl-partition-health',
      'health-long-running-queries',
      'health-oom-killed-recent',
      'health-failed-queries-recent',
      'health-replication-lag',
      'health-keeper-exceptions-recent',
      'health-memory-percent',
      'health-disk-percent',
      'health-failed-mutations',
      'health-stuck-merges',
      'health-query-timeouts',
      'health-failed-backups',
      'health-mv-refresh-failures',
      'health-readonly-replicas-detail',
      'health-max-part-count-detail',
      'health-parts-pressure-detail',
      'health-ttl-partition-health-detail',
      'health-long-running-queries-detail',
      'health-oom-killed-recent-detail',
      'health-failed-queries-recent-detail',
      'health-replication-lag-detail',
      'health-keeper-exceptions-detail',
      'health-memory-percent-detail',
      'health-disk-percent-detail',
      'health-failed-mutations-detail',
      'health-stuck-merges-detail',
      'health-query-timeouts-detail',
      'health-failed-backups-detail',
      'health-mv-refresh-failures-detail',
      'health-stuck-mutations-detail',
      'health-running-mutations-detail',
      'keeper-requests',
      'keeper-wait-time',
      'disk-io-throughput',
      'storage-policies',
    ])
  })

  describe.each(entries)('chart "%s"', (name, builder) => {
    test('returns an object with query or queries property', () => {
      const result = builder({})
      expect(result).toBeDefined()
      expect('query' in result || 'queries' in result).toBe(true)
    })

    if (name === 'summary-used-by-running-queries') {
      test('returns MultiChartQueryResult with queries array', () => {
        const result = builder({})
        if ('queries' in result) {
          expect(Array.isArray(result.queries)).toBe(true)
          expect(result.queries.length).toBeGreaterThan(0)
          for (const q of result.queries) {
            expect(q).toHaveProperty('key')
            expect(q).toHaveProperty('query')
            expect(typeof q.query).toBe('string')
            expect(q.query).toMatch(/SELECT/i)
          }
        }
      })
    } else {
      test('query is a non-empty string containing SELECT', () => {
        const result = builder({})
        if ('query' in result) {
          expect(typeof result.query).toBe('string')
          expect(result.query.length).toBeGreaterThan(0)
          expect(result.query).toMatch(/SELECT/i)
        }
      })
    }

    if (name === 'disk-size') {
      test('accepts params.name for disk filtering', () => {
        const result = builder({ params: { name: 'default' } })
        if ('query' in result) {
          expect(result.query).toContain("name = 'default'")
        }
      })
    }

    if (name === 'top-table-size') {
      test('respects params.limit for row limiting', () => {
        const result = builder({ params: { limit: 5 } })
        if ('query' in result) {
          expect(result.query).toContain('LIMIT 5')
        }
      })
    }

    if (name === 'memory-breakdown') {
      test('breaks memory down into queries/caches/merges/primary-key categories', () => {
        const result = builder({
          interval: 'toStartOfTenMinutes',
          lastHours: 24,
        })
        if ('query' in result) {
          expect(result.query).toContain('queries_memory')
          expect(result.query).toContain('caches_memory')
          expect(result.query).toContain('merges_memory')
          expect(result.query).toContain('primary_key_memory')
          // Row-based metric source: version-tolerant, no per-column errors.
          expect(result.query).toContain(
            "metric = 'CurrentMetric_MemoryTracking'"
          )
          expect(result.query).toContain('system.parts')
        }
      })
    }

    if (name === 'cpu-load-average') {
      test('derives core count from per-core OSUserTimeCPU% gauges', () => {
        const result = builder({})
        if ('query' in result) {
          expect(result.query).toContain('load_average_1m')
          expect(result.query).toContain('load_average_5m')
          expect(result.query).toContain('load_average_15m')
          expect(result.query).toContain('cpu_cores')
          expect(result.query).toContain("metric LIKE 'OSUserTimeCPU%'")
        }
      })
    }

    if (name === 'cpu-mode-split') {
      test('splits CPU time into user/system/iowait/idle', () => {
        const result = builder({})
        if ('query' in result) {
          expect(result.query).toContain('user_time')
          expect(result.query).toContain('system_time')
          expect(result.query).toContain('iowait_time')
          expect(result.query).toContain('idle_time')
        }
      })
    }

    if (name === 'thread-pool-utilization') {
      test('reads global thread pool active/total gauges from metric_log', () => {
        const result = builder({})
        if ('query' in result) {
          expect(result.query).toContain(
            'CurrentMetric_GlobalThreadPoolActiveThreads'
          )
          expect(result.query).toContain(
            'CurrentMetric_GlobalThreadPoolThreads'
          )
        }
      })
    }

    if (name === 'disks-usage') {
      // Regression: the chart used to sumMap() over every async metric for
      // 30 days, materializing a hundreds-of-keys map per group and OOMing
      // small instances (MEMORY_LIMIT_EXCEEDED). The query must pre-filter to
      // only the two disk metrics it actually reads, before aggregation.
      test('pre-filters to the two disk metrics before aggregating', () => {
        const result = builder({ interval: 'toStartOfDay', lastHours: 720 })
        if ('query' in result) {
          expect(result.query).toContain('metric IN (')
          expect(result.query).toContain('DiskAvailable_default')
          expect(result.query).toContain('DiskUsed_default')
          // The metric filter must precede GROUP BY (cuts rows + map width).
          const whereIdx = result.query.indexOf('metric IN (')
          const groupIdx = result.query.indexOf('GROUP BY')
          expect(whereIdx).toBeGreaterThan(0)
          expect(whereIdx).toBeLessThan(groupIdx)
        }
      })
    }
  })
})

/**
 * Wire-payload contract for `new-parts-created` (#2986).
 *
 * The stacked bar chart in components/charts/merge/new-parts-created.tsx types
 * its rows as exactly { event_time, table, new_parts } and reads nothing else.
 * The query used to also select total_rows / total_bytes_on_disk plus their
 * formatReadable* twins, which no consumer ever read: measured on the cloud
 * demo, that was 87.8 KB per response against 34.8 KB for the columns actually
 * plotted (60% waste), on the largest single endpoint of /overview.
 *
 * These tests fail if a dead column is reintroduced.
 */
describe('new-parts-created wire payload', () => {
  const build = systemCharts['new-parts-created']

  function sqlFor(): string {
    const def = build?.({ interval: 'toStartOfHour', lastHours: 24 })
    if (!def || !('query' in def))
      throw new Error('expected a single-query def')
    return def.query
  }

  test('selects the three columns the chart plots', () => {
    const sql = sqlFor()
    expect(sql).toContain('event_time')
    expect(sql).toContain('count() AS new_parts')
    expect(sql).toMatch(/\btable\b/)
  })

  test('does not ship columns no consumer reads', () => {
    const sql = sqlFor()
    for (const dead of [
      'total_rows',
      'readable_total_rows',
      'total_bytes_on_disk',
      'readable_total_bytes_on_disk',
    ]) {
      expect(sql).not.toContain(dead)
    }
  })

  test('still aggregates per time bucket and table', () => {
    // Dropping the sums must not change the grouping — one row per
    // (bucket, table) is what the stacked series are built from.
    expect(sqlFor()).toMatch(/GROUP BY\s+event_time,\s+table/)
  })
})
