/**
 * Insight Charts
 * Charts for the insights page displaying record-breaking query and storage statistics
 */

import type { ChartQueryBuilder } from './types'

import { buildTimeFilter } from '@/lib/clickhouse-query'

/**
 * Aggregate expression for a percentile (or max for p100).
 * Uses quantileTDigest — lower memory than exact quantile on large query_log.
 */
function percentileThreshold(percentile: string, column: string): string {
  return percentile === '100'
    ? `max(${column})`
    : `quantileTDigest(0.${percentile})(${column})`
}

/**
 * Build a WHERE filter that excludes queries whose duration exceeds the given
 * percentile threshold. For p100 no filter is applied (include everything).
 *
 * `timeFilter` is a bare condition from buildTimeFilter (no leading AND).
 */
function percentileDurationFilter(
  percentile: string,
  timeFilter: string
): string {
  if (percentile === '100') return ''
  const timeClause = timeFilter ? `AND ${timeFilter}` : ''
  return `AND query_duration_ms <= (
    SELECT ${percentileThreshold(percentile, 'query_duration_ms')}
    FROM system.query_log
    WHERE type = 'QueryFinish' AND is_initial_query = 1 ${timeClause}
  )`
}

/** Shared WHERE for finished initial queries, optionally time-bounded. */
function finishedQueryWhere(timeFilter: string, extra = ''): string {
  const timeClause = timeFilter ? `AND ${timeFilter}` : ''
  const extraClause = extra ? `AND ${extra}` : ''
  return `type = 'QueryFinish' AND is_initial_query = 1 ${timeClause} ${extraClause}`
}

/**
 * Single-pass aggregate card: compute the threshold once in a subquery, then
 * format for display. Avoids evaluating max/quantile twice in the SELECT list.
 */
function scalarAggregateQuery(
  thresholdExpr: string,
  alias: string,
  readableAlias: string,
  where: string,
  formatReadable = true
): string {
  if (formatReadable) {
    return `
      SELECT
        formatReadableSize(v) AS ${readableAlias},
        v AS ${alias}
      FROM (
        SELECT ${thresholdExpr} AS v
        FROM system.query_log
        WHERE ${where}
      )
    `
  }
  return `
    SELECT
      v AS ${alias}
    FROM (
      SELECT ${thresholdExpr} AS v
      FROM system.query_log
      WHERE ${where}
    )
  `
}

export const insightCharts: Record<string, ChartQueryBuilder> = {
  'insight-largest-scan': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    const percentile = (params.params?.percentile as string) || '99'
    const threshold = percentileThreshold(percentile, 'read_bytes')
    return {
      query: scalarAggregateQuery(
        threshold,
        'read_bytes',
        'readable_bytes',
        finishedQueryWhere(timeFilter, 'read_bytes > 0')
      ),
    }
  },

  'insight-fastest-scan': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    const percentile = (params.params?.percentile as string) || '99'
    const speedExpr = `read_bytes / greatest(query_duration_ms, 1) * 1000`
    const threshold = percentileThreshold(percentile, speedExpr)
    return {
      query: scalarAggregateQuery(
        threshold,
        'bytes_per_second',
        'readable_speed',
        finishedQueryWhere(
          timeFilter,
          'query_duration_ms > 0 AND read_bytes > 0'
        )
      ),
    }
  },

  'insight-longest-query': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    const percentile = (params.params?.percentile as string) || '99'
    const threshold = percentileThreshold(percentile, 'query_duration_ms')
    return {
      query: scalarAggregateQuery(
        threshold,
        'query_duration_ms',
        'readable_duration',
        finishedQueryWhere(timeFilter),
        false
      ),
    }
  },

  'insight-top-tables-by-size': () => ({
    query: `
      SELECT
        table,
        database,
        formatReadableSize(sum(bytes_on_disk)) as size,
        sum(bytes_on_disk) as bytes,
        formatReadableQuantity(sum(rows)) as readable_rows,
        sum(rows) as total_rows,
        count() as part_count
      FROM system.parts
      WHERE active
      GROUP BY database, table
      ORDER BY sum(bytes_on_disk) DESC
      LIMIT 10
    `,
  }),

  'insight-compression-ratios': () => ({
    query: `
      SELECT
        table,
        database,
        round(sum(data_compressed_bytes) * 1.0 / nullIf(sum(data_uncompressed_bytes), 0), 3) as compression_ratio,
        formatReadableSize(sum(data_uncompressed_bytes)) as uncompressed,
        formatReadableSize(sum(bytes_on_disk)) as compressed
      FROM system.parts
      WHERE active
      GROUP BY database, table
      HAVING sum(data_uncompressed_bytes) > 1048576
      ORDER BY compression_ratio ASC
      LIMIT 10
    `,
  }),

  'insight-total-storage': () => ({
    query: `
      SELECT
        formatReadableSize(sum(bytes_on_disk)) as total_compressed,
        formatReadableSize(sum(data_uncompressed_bytes)) as total_uncompressed,
        round(sum(data_compressed_bytes) * 1.0 / nullIf(sum(data_uncompressed_bytes), 0), 3) as overall_compression_ratio,
        countDistinct(concat(database, '.', table)) as total_tables,
        sum(rows) as total_rows,
        formatReadableQuantity(sum(rows)) as readable_rows
      FROM system.parts
      WHERE active
    `,
  }),

  'insight-query-summary': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    return {
      query: `
        SELECT
          count() as total_queries,
          formatReadableSize(sum(read_bytes)) as total_scanned,
          sum(read_rows) as total_rows_scanned,
          formatReadableQuantity(sum(read_rows)) as readable_rows,
          avg(query_duration_ms) as avg_duration_ms,
          max(query_duration_ms) as max_duration_ms,
          formatReadableSize(max(read_bytes)) as largest_scan,
          formatReadableSize(max(memory_usage)) as peak_memory
        FROM system.query_log
        WHERE type = 'QueryFinish' AND is_initial_query = 1 ${timeFilter ? `AND ${timeFilter}` : ''}
      `,
    }
  },

  // Busiest day by query count
  'insight-busiest-day-queries': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    return {
      query: `
        SELECT
          toDate(event_time) as day,
          count() as query_count,
          formatReadableQuantity(count()) as readable_count
        FROM system.query_log
        WHERE type = 'QueryFinish' AND is_initial_query = 1 ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY day
        ORDER BY query_count DESC
        LIMIT 1
      `,
    }
  },

  // Busiest day by data scanned
  'insight-busiest-day-bytes': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    return {
      query: `
        SELECT
          toDate(event_time) as day,
          sum(read_bytes) as total_bytes,
          formatReadableSize(sum(read_bytes)) as readable_bytes,
          count() as query_count
        FROM system.query_log
        WHERE type = 'QueryFinish' AND is_initial_query = 1 ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY day
        ORDER BY total_bytes DESC
        LIMIT 1
      `,
    }
  },

  // Busiest second by query starts (renamed from "peak concurrent" for accuracy)
  'insight-busiest-second': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    return {
      query: `
        SELECT
          max(concurrent) as peak_concurrent,
          formatReadableQuantity(max(concurrent)) as readable_count
        FROM (
          SELECT
            count() as concurrent
          FROM system.query_log
          WHERE type = 'QueryFinish' AND is_initial_query = 1 ${timeFilter ? `AND ${timeFilter}` : ''}
          GROUP BY event_time
        )
      `,
    }
  },

  // Query duration percentile (p95/p99/p100)
  'insight-avg-duration': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    const percentile = (params.params?.percentile as string) || '99'
    const durationExpr = percentileThreshold(percentile, 'query_duration_ms')
    return {
      query: `
        SELECT
          ${durationExpr} AS avg_duration_ms,
          count() AS query_count
        FROM system.query_log
        WHERE ${finishedQueryWhere(timeFilter)}
      `,
    }
  },

  // Query error rate
  'insight-error-rate': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    return {
      query: `
        SELECT
          round(countIf(type = 'ExceptionBeforeStart' OR type = 'ExceptionWhileProcessing') * 100.0 / count(), 2) as error_rate,
          countIf(type = 'ExceptionBeforeStart' OR type = 'ExceptionWhileProcessing') as error_count,
          count() as total_count
        FROM system.query_log
        WHERE is_initial_query = 1 ${timeFilter ? `AND ${timeFilter}` : ''}
      `,
    }
  },

  // -----------------------------------------------------------------------
  // Query Insights (volume metrics)
  // -----------------------------------------------------------------------

  // Total queries executed in the period
  'insight-total-queries': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    const percentile = (params.params?.percentile as string) || '99'
    const durationFilter = percentileDurationFilter(percentile, timeFilter)
    return {
      query: `
        SELECT
          count() as total_queries,
          formatReadableQuantity(count()) as readable_count
        FROM system.query_log
        WHERE type = 'QueryFinish' AND is_initial_query = 1 ${timeFilter ? `AND ${timeFilter}` : ''}
          ${durationFilter}
      `,
    }
  },

  // Total data scanned across all queries
  'insight-total-scanned': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    const percentile = (params.params?.percentile as string) || '99'
    const durationFilter = percentileDurationFilter(percentile, timeFilter)
    return {
      query: `
        SELECT
          sum(read_bytes) as total_bytes,
          formatReadableSize(sum(read_bytes)) as readable_total
        FROM system.query_log
        WHERE type = 'QueryFinish' AND is_initial_query = 1 ${timeFilter ? `AND ${timeFilter}` : ''}
          ${durationFilter}
      `,
    }
  },

  // Total rows read across all queries
  'insight-total-rows-read': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    const percentile = (params.params?.percentile as string) || '99'
    const durationFilter = percentileDurationFilter(percentile, timeFilter)
    return {
      query: `
        SELECT
          sum(read_rows) as total_rows,
          formatReadableQuantity(sum(read_rows)) as readable_total
        FROM system.query_log
        WHERE type = 'QueryFinish' AND is_initial_query = 1 ${timeFilter ? `AND ${timeFilter}` : ''}
          ${durationFilter}
      `,
    }
  },

  // Peak memory usage across all completed queries
  'insight-peak-memory': (params) => {
    const timeFilter = buildTimeFilter(params.lastHours)
    const percentile = (params.params?.percentile as string) || '99'
    const durationFilter = percentileDurationFilter(percentile, timeFilter)
    return {
      query: `
        SELECT
          max(memory_usage) as peak_memory,
          formatReadableSize(max(memory_usage)) as readable_peak
        FROM system.query_log
        WHERE type = 'QueryFinish' AND is_initial_query = 1 ${timeFilter ? `AND ${timeFilter}` : ''}
          ${durationFilter}
      `,
    }
  },

  // -----------------------------------------------------------------------
  // Cluster Activity (live metrics from system.processes / system.metrics)
  // -----------------------------------------------------------------------

  // Currently executing queries
  'insight-active-queries': () => ({
    query: `
      SELECT
        count() as active_queries,
        formatReadableQuantity(count()) as readable_count
      FROM system.processes
    `,
  }),

  // Current memory tracking from system.metrics
  'insight-current-memory': () => ({
    query: `
      SELECT
        value as memory_bytes,
        formatReadableSize(value) as readable_memory
      FROM system.metrics
      WHERE metric = 'MemoryTracking'
    `,
  }),

  // HTTP connections from system.metrics
  'insight-http-connections': () => ({
    query: `
      SELECT
        value as connections,
        formatReadableQuantity(value) as readable_connections
      FROM system.metrics
      WHERE metric = 'HTTPConnection'
    `,
  }),

  // Active merge operations
  'insight-active-merges': () => ({
    query: `
      SELECT
        count() as active_merges,
        formatReadableQuantity(count()) as readable_count
      FROM system.merges
    `,
  }),

  // -----------------------------------------------------------------------
  // Storage & Operations
  // -----------------------------------------------------------------------

  // Total active parts across all tables
  'insight-active-parts': () => ({
    query: `
      SELECT
        count() as active_parts,
        formatReadableQuantity(count()) as readable_parts,
        sum(rows) as total_rows,
        formatReadableQuantity(sum(rows)) as readable_rows
      FROM system.parts
      WHERE active
    `,
  }),

  // Detached parts count (optional — table may not exist)
  'insight-detached-parts': () => ({
    query: `
      SELECT
        count() as detached_parts,
        formatReadableQuantity(count()) as readable_parts
      FROM system.detached_parts
    `,
    optional: true,
    tableCheck: 'system.detached_parts',
  }),

  // Active (in-progress) mutations
  'insight-active-mutations': () => ({
    query: `
      SELECT
        count() as active_mutations,
        formatReadableQuantity(count()) as readable_count
      FROM system.mutations
      WHERE is_done = 0
    `,
  }),
}
