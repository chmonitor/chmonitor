/**
 * Query Monitoring Charts
 * Charts for tracking query performance, counts, and memory usage
 */

import type { ChartQueryBuilder } from './types'

import { applyInterval, buildTimeFilter, fillStep, nowOrToday } from './types'

export const queryCharts: Record<string, ChartQueryBuilder> = {
  'query-count-today': () => ({
    query: `
      SELECT COUNT() AS count
      FROM merge('system', '^query_log')
      WHERE type = 'QueryFinish'
        AND toDate(event_time) = today()
      SETTINGS max_execution_time = 25
    `,
  }),

  'query-count': ({ interval = 'toStartOfDay', lastHours = 24 * 14 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    WITH event_count AS (
      SELECT ${applyInterval(interval, 'event_time')},
             COUNT() AS query_count
      FROM merge('system', '^query_log')
      WHERE type = 'QueryFinish'
            ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY event_time
      ORDER BY event_time WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
    ),
    query_kind AS (
      SELECT ${applyInterval(interval, 'event_time')},
               query_kind,
               COUNT() AS count
        FROM merge('system', '^query_log')
        WHERE type = 'QueryFinish'
              ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY 1, 2
        ORDER BY 3 DESC
    ),
    breakdown AS (
      SELECT event_time,
             groupArray((query_kind, count)) AS breakdown
      FROM query_kind
      GROUP BY 1
    )
    SELECT event_time,
           query_count,
           breakdown.breakdown AS breakdown
    FROM event_count
    LEFT JOIN breakdown USING event_time
    ORDER BY 1
    SETTINGS max_execution_time = 25
  `,
    }
  },

  'query-count-by-user': ({
    interval = 'toStartOfDay',
    lastHours = 24 * 14,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           user,
           COUNT(*) AS count
    FROM merge('system', '^query_log')
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
          AND user != ''
    GROUP BY 1, 2
    ORDER BY
      1 ASC,
      3 DESC
    SETTINGS max_execution_time = 25
  `,
    }
  },

  'query-duration': ({ interval = 'toStartOfDay', lastHours = 24 * 14 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           AVG(query_duration_ms) AS query_duration_ms,
           ROUND(query_duration_ms / 1000, 2) AS query_duration_s
    FROM merge('system', '^query_log')
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
    SETTINGS max_execution_time = 25
  `,
    }
  },

  'query-memory': ({ interval = 'toStartOfDay', lastHours = 24 * 14 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           AVG(memory_usage) AS memory_usage,
           formatReadableSize(memory_usage) AS readable_memory_usage
    FROM merge('system', '^query_log')
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
    SETTINGS max_execution_time = 25
  `,
    }
  },

  // Sampled memory envelope from system.query_metric_log (per-query samples,
  // one row per query per sampling interval). Bucketed max(memory) + max(peak)
  // over the window shows the memory high-water mark across all queries over
  // time. optional + tableCheck: the table is opt-in and absent on many
  // servers, so the executor skips it gracefully rather than erroring.
  'query-metric-log-memory': ({
    interval = 'toStartOfFiveMinutes',
    lastHours = 6,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      optional: true,
      tableCheck: 'system.query_metric_log',
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           max(memory_usage) AS memory_usage,
           max(peak_memory_usage) AS peak_memory_usage,
           formatReadableSize(max(memory_usage)) AS readable_memory_usage,
           formatReadableSize(max(peak_memory_usage)) AS readable_peak_memory_usage
    FROM system.query_metric_log
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
    SETTINGS max_execution_time = 25
  `,
    }
  },

  'query-type': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT type,
           COUNT() AS query_count
    FROM merge('system', '^query_log')
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1
    SETTINGS max_execution_time = 25
  `,
    }
  },

  'query-cache': () => ({
    query: `
    SELECT
      sumIf(result_size, stale = 0) AS total_result_size,
      sumIf(result_size, stale = 1) AS total_staled_result_size,
      formatReadableSize(total_result_size) AS readable_total_result_size,
      formatReadableSize(total_staled_result_size) AS readable_total_staled_result_size
    FROM system.query_cache
  `,
  }),

  // query_cache_usage column only exists from v24.1. VersionedSql picks the
  // highest `since` <= CH version; the first (oldest) entry is the fallback for
  // older / unknown versions. (Replaces the deprecated `variants` form, which
  // the TSR executor does not select.)
  'query-cache-usage': ({ lastHours = 24 * 7 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
      query_cache_usage,
      COUNT() AS query_count,
      round(100 * query_count / sum(query_count) OVER (), 2) AS percentage
    FROM merge('system', '^query_log')
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY query_cache_usage
    ORDER BY query_count DESC
    SETTINGS max_execution_time = 25
  `,
      sql: [
        {
          since: '1.0',
          sql: `SELECT 'Not available' AS query_cache_usage, 0 AS query_count, 0 AS percentage`,
        },
        {
          since: '24.1',
          sql: `
    SELECT
      query_cache_usage,
      COUNT() AS query_count,
      round(100 * query_count / sum(query_count) OVER (), 2) AS percentage
    FROM merge('system', '^query_log')
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY query_cache_usage
    ORDER BY query_count DESC
    SETTINGS max_execution_time = 25
  `,
        },
      ],
    }
  },

  'top-query-fingerprints': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    WITH top_hashes AS (
      SELECT normalized_query_hash, count() AS total
      FROM merge('system', '^query_log')
      WHERE type = 'QueryFinish'
            ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY normalized_query_hash
      ORDER BY total DESC
      LIMIT 10
    )
    SELECT
        ${applyInterval(interval, 'q.event_time', 'event_time')},
        q.normalized_query_hash AS hash,
        substring(any(q.query), 1, 80) AS query_preview,
        count() AS count
    FROM merge('system', '^query_log') AS q
    INNER JOIN top_hashes AS t ON q.normalized_query_hash = t.normalized_query_hash
    WHERE q.type = 'QueryFinish'
          ${timeFilter ? `AND ${buildTimeFilter(lastHours, 'q.event_time')}` : ''}
    GROUP BY 1, 2
    ORDER BY 1 ASC, 4 DESC
    SETTINGS max_execution_time = 25
  `,
    }
  },

  'failed-query-count': ({
    interval = 'toStartOfMinute',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    WITH event_count AS (
      SELECT ${applyInterval(interval, 'event_time')},
             COUNT() AS query_count
      FROM merge('system', '^query_log')
      PREWHERE
            type IN ['ExceptionBeforeStart', 'ExceptionWhileProcessing']
            ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY 1
      ORDER BY 1
    ),
    query_type AS (
        SELECT ${applyInterval(interval, 'event_time')},
               type AS query_type,
               COUNT() AS count
        FROM merge('system', '^query_log')
        PREWHERE
              type IN ['ExceptionBeforeStart', 'ExceptionWhileProcessing']
              ${timeFilter ? `AND ${timeFilter}` : ''}
        GROUP BY 1, 2
        ORDER BY 3 DESC
    ),
    breakdown AS (
      SELECT event_time,
             groupArray((query_type, count)) AS breakdown
      FROM query_type
      GROUP BY 1
    )
    SELECT event_time,
           query_count,
           breakdown.breakdown AS breakdown
    FROM event_count
    LEFT JOIN breakdown USING event_time
    ORDER BY 1
    SETTINGS max_execution_time = 25
  `,
    }
  },

  'cancelled-queries': ({ interval = 'toStartOfHour', lastHours = 24 * 7 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           exception_code,
           COUNT() AS count
    FROM merge('system', '^query_log')
    WHERE type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')
          AND exception_code IN (394, 159)
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1, 2
    ORDER BY 1 ASC
    SETTINGS max_execution_time = 25
  `,
    }
  },

  'failed-query-count-by-user': ({
    interval = 'toStartOfDay',
    lastHours = 24 * 14,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           user,
           countDistinct(query_id) AS count
    FROM merge('system', '^query_log')
    PREWHERE
          type IN ['ExceptionBeforeStart', 'ExceptionWhileProcessing']
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1, 2
    ORDER BY
      1 ASC,
      3 DESC
    SETTINGS max_execution_time = 25
  `,
    }
  },

  'query-duration-percentiles': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
  SELECT ${applyInterval(interval, 'event_time')},
         round(quantile(0.50)(query_duration_ms) / 1000, 3) AS p50_s,
         round(quantile(0.95)(query_duration_ms) / 1000, 3) AS p95_s,
         round(quantile(0.99)(query_duration_ms) / 1000, 3) AS p99_s
  FROM merge('system', '^query_log')
  WHERE type = 'QueryFinish'
        ${timeFilter ? `AND ${timeFilter}` : ''}
  GROUP BY event_time
  ORDER BY event_time ASC
  WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  SETTINGS max_execution_time = 25
`,
    }
  },

  'slow-query-occurrences': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           COUNT() AS count
    FROM merge('system', '^query_log')
    WHERE type = 'QueryFinish'
          AND query_duration_ms >= 5000
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
    WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
    SETTINGS max_execution_time = 25
  `,
    }
  },

  // Per-day activity metrics for the GitHub-style "Activity Calendar" heatmap.
  // One row per calendar day carrying every switchable metric (query volume,
  // failures, peak memory, avg duration, bytes written) so the client can flip
  // modes without a refetch. Conditional aggregation keeps it a single daily
  // scan. Default window is one year (24 * 365 hours) → ~53 calendar columns.
  //
  // SETTINGS max_execution_time=25: keeps execution under the Cloudflare Worker
  // response timeout (~30s). Without it, a slow full-year scan on a busy server
  // drops the connection mid-stream, returning an empty body (error 1016 —
  // RECEIVED_EMPTY_DATA) instead of a clean ClickHouse timeout error (159).
  'query-count-heatmap': ({ lastHours = 24 * 365 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      query: `
    SELECT
        toString(toDate(event_time)) AS date,
        countIf(type = 'QueryFinish') AS query_count,
        countIf(type = 'ExceptionBeforeStart' OR type = 'ExceptionWhileProcessing') AS failed_count,
        max(memory_usage) AS memory_peak,
        round(avgIf(query_duration_ms, type = 'QueryFinish'), 2) AS avg_duration_ms,
        sumIf(written_bytes, type = 'QueryFinish') AS written_bytes
    FROM merge('system', '^query_log')
    WHERE (type = 'QueryFinish'
           OR type = 'ExceptionBeforeStart'
           OR type = 'ExceptionWhileProcessing')
      ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY date
    ORDER BY date ASC
    SETTINGS max_execution_time = 25
  `,
    }
  },

  /**
   * Slow query regression detection (#1921).
   *
   * Compares P95 query_duration_ms per normalized fingerprint between the
   * current window (last 1h) and the baseline (previous 24h). Returns
   * fingerprints where P95 has grown by ≥2× with at least 3 samples in each
   * window. Ordered worst regression first.
   */
  'slow-query-regressions': () => ({
    query: `
    WITH
      now() AS ref_time,
      ref_time - INTERVAL 1 HOUR AS current_start,
      current_start - INTERVAL 24 HOUR AS baseline_start,
      current_data AS (
        SELECT
          replaceRegexpAll(
            replaceRegexpAll(lower(trimBoth(query)), '(''[^'']*''|\\b\\d+(?:\\.\\d+)?\\b|\\{[^}]+\\})', '?'),
            '\\s+', ' '
          ) AS fingerprint,
          query_duration_ms
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND event_time >= current_start AND event_time < ref_time
          AND query NOT LIKE '%system.%' AND is_initial_query = 1
      ),
      baseline_data AS (
        SELECT
          replaceRegexpAll(
            replaceRegexpAll(lower(trimBoth(query)), '(''[^'']*''|\\b\\d+(?:\\.\\d+)?\\b|\\{[^}]+\\})', '?'),
            '\\s+', ' '
          ) AS fingerprint,
          query_duration_ms
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND event_time >= baseline_start AND event_time < current_start
          AND query NOT LIKE '%system.%' AND is_initial_query = 1
      ),
      current_stats AS (
        SELECT fingerprint,
               count() AS current_count,
               round(quantile(0.95)(query_duration_ms)) AS current_p95_ms,
               round(avg(query_duration_ms)) AS current_avg_ms
        FROM current_data GROUP BY fingerprint HAVING current_count >= 3
      ),
      baseline_stats AS (
        SELECT fingerprint,
               count() AS baseline_count,
               round(quantile(0.95)(query_duration_ms)) AS baseline_p95_ms,
               round(avg(query_duration_ms)) AS baseline_avg_ms
        FROM baseline_data GROUP BY fingerprint HAVING baseline_count >= 3
      )
    SELECT
      c.fingerprint,
      c.current_count,
      c.current_p95_ms,
      c.current_avg_ms,
      b.baseline_count,
      b.baseline_p95_ms,
      b.baseline_avg_ms,
      round(c.current_p95_ms / nullIf(b.baseline_p95_ms, 0), 2) AS regression_factor,
      substr(c.fingerprint, 1, 200) AS fingerprint_short
    FROM current_stats c
    INNER JOIN baseline_stats b USING (fingerprint)
    WHERE c.current_p95_ms >= b.baseline_p95_ms * 2 AND b.baseline_p95_ms > 100
    ORDER BY regression_factor DESC
    LIMIT 20
  `,
    optional: true,
    tableCheck: 'system.query_log',
  }),

  /**
   * MV refresh staleness (#1925).
   * Returns all view_refreshes rows enriched with staleness_seconds.
   */
  'mv-staleness': () => ({
    query: `
    SELECT
      database,
      view,
      status,
      last_success_time,
      last_refresh_time,
      next_refresh_time,
      dateDiff('second', coalesce(last_success_time, toDateTime(0)), now()) AS staleness_seconds,
      multiIf(
        status IN ('Error', 'Failed'), 1,
        isNull(last_success_time), 1,
        dateDiff('second', last_success_time, now()) > 3600, 1,
        0
      ) AS is_failed,
      exception
    FROM system.view_refreshes
    WHERE status NOT IN ('Running', 'Scheduled')
    ORDER BY is_failed DESC, staleness_seconds DESC
  `,
    optional: true,
    tableCheck: 'system.view_refreshes',
  }),
}
