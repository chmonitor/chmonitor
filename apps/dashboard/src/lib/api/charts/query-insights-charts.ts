import type { ChartQueryBuilder } from './types'

import {
  applyInterval,
  buildTimeFilter,
  CHART_QUERY_SETTINGS,
  fillStep,
  nowOrToday,
} from './types'

/** Builds a p10/p25/p50/p75/p90/p95/p99 single-row distribution query for one metric column. */
function percentileDistributionQuery(
  column: string,
  decimals: number,
  timeFilter: string,
  extraFilter = ''
): string {
  const round = (expr: string) =>
    decimals > 0 ? `round(${expr}, ${decimals})` : `round(${expr})`
  return `
    SELECT
      ${round(`quantile(0.10)(${column})`)} AS p10,
      ${round(`quantile(0.25)(${column})`)} AS p25,
      ${round(`quantile(0.50)(${column})`)} AS p50,
      ${round(`quantile(0.75)(${column})`)} AS p75,
      ${round(`quantile(0.90)(${column})`)} AS p90,
      ${round(`quantile(0.95)(${column})`)} AS p95,
      ${round(`quantile(0.99)(${column})`)} AS p99
    FROM system.query_log
    WHERE type = 'QueryFinish'
          ${extraFilter}
          ${timeFilter ? `AND ${timeFilter}` : ''}
  `
}

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
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

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
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

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
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

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
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
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
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

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
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

  'query-insights-memory': ({ interval = 'toStartOfHour', lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = `
    SELECT ${applyInterval(interval, 'event_time')},
           round(avg(memory_usage)) AS avg_memory,
           round(quantile(0.95)(memory_usage)) AS p95_memory,
           round(quantile(0.99)(memory_usage)) AS p99_memory
    FROM system.query_log
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

  'query-insights-read-throughput': ({
    interval = 'toStartOfHour',
    lastHours = 24,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = `
    SELECT ${applyInterval(interval, 'event_time')},
           sum(read_bytes) AS read_bytes,
           sum(result_bytes) AS result_bytes
    FROM system.query_log
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

  'query-insights-top-users': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = `
    SELECT
      user,
      COUNT() AS query_count,
      round(100 * query_count / sum(query_count) OVER (), 2) AS percentage
    FROM system.query_log
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY user
    ORDER BY query_count DESC
    LIMIT 8
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

  'query-insights-duration-distribution': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = percentileDistributionQuery(
      'query_duration_ms',
      2,
      timeFilter
    )
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

  'query-insights-memory-distribution': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = percentileDistributionQuery('memory_usage', 0, timeFilter)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

  'query-insights-read-rows-distribution': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = percentileDistributionQuery('read_rows', 0, timeFilter)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

  'query-insights-read-bytes-distribution': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = percentileDistributionQuery('read_bytes', 0, timeFilter)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

  'query-insights-errors-by-code': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = `
    SELECT
      exception_code,
      COUNT() AS count,
      any(exception) AS sample,
      max(event_time) AS last_seen
    FROM system.query_log
    WHERE exception_code != 0
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY exception_code
    ORDER BY count DESC
    LIMIT 10
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },

  'query-insights-hot-tables': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    const query = `
    SELECT
      arrayJoin(tables) AS table,
      COUNT() AS query_count,
      round(avg(query_duration_ms), 2) AS avg_duration_ms
    FROM system.query_log
    WHERE type = 'QueryFinish'
          AND notEmpty(tables)
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY table
    ORDER BY query_count DESC
    LIMIT 10
  `
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query,
      sql: [{ since: '19.1', sql: query }],
    }
  },
}
