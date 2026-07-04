/**
 * Query Insights Overview Charts
 *
 * Backs the `/queries/insights` overview grid (parity with ClickHouse
 * Cloud's Query Insights): QPS, latency percentiles, operations breakdown,
 * rows read/returned, cache hit ratio, and errors over time — all derived
 * from `system.query_log`.
 */

import type { ChartQueryBuilder } from './types'

import { applyInterval, buildTimeFilter, fillStep, nowOrToday } from './types'

/** Bucket width in seconds per interval, used to derive a queries/sec rate. */
const INTERVAL_SECONDS: Record<string, number> = {
  toStartOfMinute: 60,
  toStartOfFiveMinutes: 300,
  toStartOfTenMinutes: 600,
  toStartOfFifteenMinutes: 900,
  toStartOfHour: 3600,
  toStartOfDay: 86400,
  toStartOfWeek: 604800,
  toStartOfMonth: 2629746, // average month length
}

export const queryInsightsCharts: Record<string, ChartQueryBuilder> = {
  // Tile 1: Queries / sec — query volume as a rate over the range.
  'query-insights-qps': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const bucketSeconds = INTERVAL_SECONDS[interval] ?? 3600
    const query = `
    SELECT ${applyInterval(interval, 'event_time')},
           round(COUNT() / ${bucketSeconds}, 3) AS qps
    FROM system.query_log
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
    SETTINGS max_execution_time = 25
  `
    return { query, sql: [{ since: '19.1', sql: query }] }
  },

  // Tile 2: Query latency — mean + p50/p95/p99 on one chart.
  'query-insights-latency': ({
    interval = 'toStartOfHour',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = `
    SELECT ${applyInterval(interval, 'event_time')},
           round(avg(query_duration_ms), 2) AS avg_duration_ms,
           round(quantile(0.50)(query_duration_ms), 2) AS p50_duration_ms,
           round(quantile(0.95)(query_duration_ms), 2) AS p95_duration_ms,
           round(quantile(0.99)(query_duration_ms), 2) AS p99_duration_ms
    FROM system.query_log
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
    SETTINGS max_execution_time = 25
  `
    return { query, sql: [{ since: '19.1', sql: query }] }
  },

  // Tile 3: Operations breakdown — donut by query_kind (Select/Insert/…).
  'query-insights-operations': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = `
    SELECT
      query_kind,
      COUNT() AS query_count,
      round(100 * query_count / sum(query_count) OVER (), 2) AS percentage
    FROM system.query_log
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY query_kind
    ORDER BY query_count DESC
    SETTINGS max_execution_time = 25
  `
    return { query, sql: [{ since: '19.1', sql: query }] }
  },

  // Tile 4: Rows read / returned.
  'query-insights-rows': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = `
    SELECT ${applyInterval(interval, 'event_time')},
           sum(read_rows) AS read_rows,
           sum(result_rows) AS result_rows
    FROM system.query_log
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
    SETTINGS max_execution_time = 25
  `
    return { query, sql: [{ since: '19.1', sql: query }] }
  },

  // Tile 5: Cache hit ratio — ProfileEvents MarkCache/UncompressedCache hits
  // vs misses (different from `query-cache-usage`, which is the
  // query-result-cache `query_cache_usage` ratio used on Slow Query Patterns).
  'query-insights-cache-hit-ratio': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = `
    SELECT
      sum(ProfileEvents['MarkCacheHits']) + sum(ProfileEvents['UncompressedCacheHits']) AS hits,
      sum(ProfileEvents['MarkCacheMisses']) + sum(ProfileEvents['UncompressedCacheMisses']) AS misses
    FROM system.query_log
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    SETTINGS max_execution_time = 25
  `
    return { query, sql: [{ since: '19.1', sql: query }] }
  },

  // Tile 6: Errors over time — exception_code != 0.
  'query-insights-errors': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = `
    SELECT ${applyInterval(interval, 'event_time')},
           COUNT() AS errors
    FROM system.query_log
    WHERE exception_code != 0
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
    SETTINGS max_execution_time = 25
  `
    return { query, sql: [{ since: '19.1', sql: query }] }
  },
}
