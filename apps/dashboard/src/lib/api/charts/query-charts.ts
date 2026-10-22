import type { ChartQueryBuilder } from './types'

import {
  applyInterval,
  buildTimeFilter,
  CHART_QUERY_SETTINGS,
  fillStep,
  nowOrToday,
} from './types'
import { USAGE_END_EVENTS } from '@/lib/query-config/queries/usage'

const QUERIES_PERMISSION = { feature: 'queries' } as const

/** Max window of the per-user activity calendar: one row per day. */
export const USER_CALENDAR_MAX_DAYS = 365
/** Max window of the weekday x hour heatmap, same as the usage aggregates. */
export const HOUR_HEATMAP_MAX_DAYS = 30

/** The `user` chart param, or null when absent or empty. */
function chartUserParam(params: Record<string, unknown> | undefined) {
  const user = params?.user
  return typeof user === 'string' && user !== '' ? user : null
}

/** Whole days covered by `lastHours`, clamped to [1, max]. */
function windowDays(lastHours: number | undefined, max: number): number {
  const hours = Number.isFinite(lastHours) ? Number(lastHours) : max * 24
  return Math.min(max, Math.max(1, Math.ceil(hours / 24)))
}

/**
 * One user's activity calendar: the same columns as the server-wide calendar,
 * filtered on a bound `user` param, bounded by `event_date` (at most a year)
 * and gated on the queries feature because it names a user.
 */
function userCalendarQuery(user: string, lastHours: number | undefined) {
  return {
    clickhouseSettings: CHART_QUERY_SETTINGS,
    permission: QUERIES_PERMISSION,
    queryParams: {
      user,
      days: windowDays(lastHours, USER_CALENDAR_MAX_DAYS),
    },
    query: `
    SELECT
        toString(event_date) AS date,
        countIf(type = 'QueryFinish') AS query_count,
        countIf(type != 'QueryFinish') AS failed_count,
        max(memory_usage) AS memory_peak,
        round(avgIf(query_duration_ms, type = 'QueryFinish'), 2) AS avg_duration_ms,
        sumIf(written_bytes, type = 'QueryFinish') AS written_bytes
    FROM merge('system', '^query_log')
    WHERE (${USAGE_END_EVENTS})
      AND (user = {user:String})
      AND (event_date >= today() - least({days:UInt16}, ${USER_CALENDAR_MAX_DAYS}))
    GROUP BY date
    ORDER BY date ASC
    LIMIT ${USER_CALENDAR_MAX_DAYS + 1}
  `,
  }
}

export const queryCharts: Record<string, ChartQueryBuilder> = {
  'query-count-today': () => ({
    clickhouseSettings: CHART_QUERY_SETTINGS,
    query: `
      SELECT COUNT() AS count
      FROM merge('system', '^query_log')
      WHERE type = 'QueryFinish'
        AND event_time >= toStartOfDay(now())
    `,
  }),

  'query-count': ({ interval = 'toStartOfDay', lastHours = 24 * 14 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query: `
    WITH per_kind AS (
      SELECT ${applyInterval(interval, 'event_time')},
             query_kind,
             COUNT() AS count
      FROM merge('system', '^query_log')
      WHERE type = 'QueryFinish'
            ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY event_time, query_kind
    )
    SELECT event_time,
           sum(count) AS query_count,
           groupArray((query_kind, count)) AS breakdown
    FROM (
      SELECT event_time, query_kind, count
      FROM per_kind
      ORDER BY count DESC
    )
    GROUP BY event_time
    ORDER BY event_time WITH FILL TO ${nowOrToday(interval)} STEP ${fillStep(interval)}
  `,
    }
  },

  'query-count-by-user': ({
    interval = 'toStartOfDay',
    lastHours = 24 * 14,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
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
  `,
    }
  },

  'query-duration': ({ interval = 'toStartOfDay', lastHours = 24 * 14 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
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
  `,
    }
  },

  'query-memory': ({ interval = 'toStartOfDay', lastHours = 24 * 14 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           AVG(memory_usage) AS memory_usage,
           formatReadableSize(memory_usage) AS readable_memory_usage
    FROM merge('system', '^query_log')
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
  `,
    }
  },

  // Sampled memory envelope from system.query_metric_log (per-query samples,
  // one row per query per sampling interval). Bucketed max(memory) + max(peak)
  // over the window shows the memory high-water mark across all queries over
  // time. optional + tableCheck: the table is opt-in and absent on many
  // servers, so the executor skips it gracefully rather than erroring.
  //
  // The two `readable_*` columns qualify their source as
  // `query_metric_log.memory_usage` / `query_metric_log.peak_memory_usage`. The
  // bare spelling is substituted with the sibling aliases of the same names,
  // which nests an aggregate inside an aggregate and fails with
  // `Code: 184 ILLEGAL_AGGREGATION` on every ClickHouse whose analyzer is on
  // (24.3+). The qualifier leaves the OUTPUT column names unchanged, so the
  // chart component keeps reading `readable_memory_usage`.
  'query-metric-log-memory': ({
    interval = 'toStartOfFiveMinutes',
    lastHours = 6,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      optional: true,
      tableCheck: 'system.query_metric_log',
      query: `
    SELECT ${applyInterval(interval, 'event_time')},
           max(memory_usage) AS memory_usage,
           max(peak_memory_usage) AS peak_memory_usage,
           formatReadableSize(max(query_metric_log.memory_usage)) AS readable_memory_usage,
           formatReadableSize(max(query_metric_log.peak_memory_usage)) AS readable_peak_memory_usage
    FROM system.query_metric_log
    ${timeFilter ? `WHERE ${timeFilter}` : ''}
    GROUP BY event_time
    ORDER BY event_time ASC
  `,
    }
  },

  'query-type': ({ lastHours = 24 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query: `
    SELECT type,
           COUNT() AS query_count
    FROM merge('system', '^query_log')
    WHERE type = 'QueryFinish'
          ${timeFilter ? `AND ${timeFilter}` : ''}
    GROUP BY 1
    ORDER BY 1
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
      clickhouseSettings: CHART_QUERY_SETTINGS,
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
      clickhouseSettings: CHART_QUERY_SETTINGS,
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
  `,
    }
  },

  'failed-query-count': ({
    interval = 'toStartOfMinute',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
      query: `
    WITH per_type AS (
      SELECT ${applyInterval(interval, 'event_time')},
             type AS query_type,
             COUNT() AS count
      FROM merge('system', '^query_log')
      PREWHERE
            type IN ['ExceptionBeforeStart', 'ExceptionWhileProcessing']
            ${timeFilter ? `AND ${timeFilter}` : ''}
      GROUP BY event_time, query_type
    )
    SELECT event_time,
           sum(count) AS query_count,
           groupArray((query_type, count)) AS breakdown
    FROM (
      SELECT event_time, query_type, count
      FROM per_type
      ORDER BY count DESC
    )
    GROUP BY event_time
    ORDER BY event_time
  `,
    }
  },

  'cancelled-queries': ({ interval = 'toStartOfHour', lastHours = 24 * 7 }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
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
  `,
    }
  },

  'failed-query-count-by-user': ({
    interval = 'toStartOfDay',
    lastHours = 24 * 14,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
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
  `,
    }
  },

  'query-duration-percentiles': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
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
`,
    }
  },

  'slow-query-occurrences': ({
    interval = 'toStartOfHour',
    lastHours = 24 * 7,
  }) => {
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
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
  `,
    }
  },

  // Per-day activity metrics for the GitHub-style "Activity Calendar" heatmap.
  // One row per calendar day carrying every switchable metric (query volume,
  // failures, peak memory, avg duration, bytes written) so the client can flip
  // modes without a refetch. Conditional aggregation keeps it a single daily
  // scan. Default window is two years (24 * 365 * 2 hours) so wide viewports
  // can render more than a year of months; the client trims to what fits and
  // caps the window at the oldest row actually returned.
  //
  // CHART_QUERY_SETTINGS (max_execution_time=25): keeps execution under the Cloudflare Worker
  // response timeout (~30s). Without it, a slow full-year scan on a busy server
  // drops the connection mid-stream, returning an empty body (error 1016 —
  // RECEIVED_EMPTY_DATA) instead of a clean ClickHouse timeout error (159).
  'query-count-heatmap': ({ lastHours = 24 * 365 * 2, params }) => {
    const user = chartUserParam(params)
    if (user !== null) return userCalendarQuery(user, lastHours)
    const timeFilter = buildTimeFilter(lastHours)
    return {
      clickhouseSettings: CHART_QUERY_SETTINGS,
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
  `,
    }
  },

  // Weekday x hour query counts for the hour heatmap (#4125). Optional
  // `user` param narrows to one user; the window is capped at 30 days in SQL.
  'query-hour-heatmap': ({ lastHours = 24 * 7, params }) => ({
    clickhouseSettings: CHART_QUERY_SETTINGS,
    permission: QUERIES_PERMISSION,
    queryParams: {
      user: chartUserParam(params) ?? '',
      days: windowDays(lastHours, HOUR_HEATMAP_MAX_DAYS),
    },
    query: `
    SELECT
        toDayOfWeek(event_time) AS weekday,
        toHour(event_time) AS hour,
        count() AS queries
    FROM merge('system', '^query_log')
    WHERE (${USAGE_END_EVENTS})
      AND ({user:String} = '' OR user = {user:String})
      AND (event_date >= today() - least({days:UInt16}, ${HOUR_HEATMAP_MAX_DAYS}))
    GROUP BY weekday, hour
    ORDER BY weekday, hour
    LIMIT 168
  `,
  }),

  /**
   * Slow query regression detection.
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
   * MV refresh staleness.
   * Returns all view_refreshes rows enriched with staleness_seconds.
   */
  'mv-staleness': () => {
    const sql = (failed: string) => `
    SELECT
      database,
      view,
      status,
      last_success_time,
      last_refresh_time,
      next_refresh_time,
      dateDiff('second', coalesce(last_success_time, toDateTime(0)), now()) AS staleness_seconds,
      multiIf(
        ${failed}, 1,
        isNull(last_success_time), 1,
        dateDiff('second', last_success_time, now()) > 3600, 1,
        0
      ) AS is_failed,
      exception
    FROM system.view_refreshes
    WHERE status NOT IN ('Running', 'Scheduled')
    ORDER BY is_failed DESC, staleness_seconds DESC
  `
    return {
      query: sql("exception != '' OR retry > 0"),
      // `retry` arrives in 25.3; 24.x has only `exception`. The oldest entry
      // is also the fallback when the server version is unknown.
      sql: [
        { since: '24.3', sql: sql("exception != ''") },
        { since: '25.3', sql: sql("exception != '' OR retry > 0") },
      ],
      optional: true,
      tableCheck: 'system.view_refreshes',
    }
  },
}
