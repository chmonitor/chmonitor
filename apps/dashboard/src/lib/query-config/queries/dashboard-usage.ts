import type { QueryConfig } from '@/types/query-config'

import {
  USAGE_DATE_BOUND,
  USAGE_DAYS_PRESETS,
  USAGE_END_EVENTS,
  USAGE_MAX_DAYS,
} from './usage'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Dashboard usage (#4164): what this dashboard itself sent to ClickHouse, read
 * back from the attribution record on each query (`packages/clickhouse-client
 * /src/attribution`). The record arrives in one or both of two carriers:
 *
 * - `log_comment` JSON (`{"app":"chmonitor","v":1,"user":…}`);
 * - the leading SQL comment, `/* {"client":"clickhouse-monitoring",
 *   "app":"chmonitor","v":1,…} *\/`. It is on by default, and it is the only
 *   carrier when a `readonly = 1` profile refuses `log_comment`.
 *
 * {@link ATTRIBUTION_JSON} picks the record once: `log_comment` first, then
 * the leading comment. The comment body never contains `*` (the encoder's
 * safe charset), so `[^*]*` captures it whole; `[*]` and `[{]` match the
 * literal characters without a backslash, so the regex survives both the TS
 * template and the ClickHouse string literal unchanged.
 */

const LOG_COMMENT_RECORD = `JSONExtractString(log_comment, 'app') = 'chmonitor'`
const LEADING_COMMENT_JSON = `extract(query, '^[[:space:]]*/[*] *([{][^*]*[}]) *[*]/')`

/** The attribution record JSON of a query_log row, or '' when it has none. */
export const ATTRIBUTION_JSON = `if(${LOG_COMMENT_RECORD}, log_comment, ${LEADING_COMMENT_JSON})`

/** One field of the attribution record, '' when absent. */
export function dashboardUsageAttr(key: string): string {
  return `JSONExtractString(${ATTRIBUTION_JSON}, '${key}')`
}
const attr = dashboardUsageAttr

/** Longest window any dashboard usage table or chart scans. */
export const DASHBOARD_USAGE_MAX_DAYS = USAGE_MAX_DAYS

const DASHBOARD_FILTER = `${attr('app')} = 'chmonitor'`

/**
 * Optional filter to one dashboard user, a bound param; '' means everyone.
 * It is the record's `user`, not query_log.user (the ClickHouse account).
 */
const USER_FILTER = `({dashboard_user:String} = '' OR ${attr('user')} = {dashboard_user:String})`

const WHERE = `
      WHERE (${USAGE_END_EVENTS})
        AND (${USAGE_DATE_BOUND})
        AND ${DASHBOARD_FILTER}
        AND ${USER_FILTER}`

/**
 * WHERE for the dashboard usage charts, bounded in hours: `event_date` for
 * partition pruning, `event_time` for the exact window, both capped in SQL.
 */
export const dashboardUsageWhere = `WHERE (${USAGE_END_EVENTS})
      AND event_date >= toDate(now() - toIntervalHour(least({hours:UInt32}, ${USAGE_MAX_DAYS * 24})))
      AND event_time >= now() - toIntervalHour(least({hours:UInt32}, ${USAGE_MAX_DAYS * 24}))
      AND ${DASHBOARD_FILTER}
      AND ${USER_FILTER}`

/** Params every dashboard usage config binds; `dashboard_user` '' is everyone. */
const DEFAULT_PARAMS = { days: '7', dashboard_user: '' }

const METRICS = `
          count() AS queries,
          countIf(type != 'QueryFinish') AS errors,
          round(quantile(0.95)(query_duration_ms)) AS p95_ms,
          sum(read_bytes) AS bytes_read,
          formatReadableSize(bytes_read) AS readable_bytes_read,
          formatReadableSize(max(memory_usage)) AS peak_memory,
          max(event_time) AS last_seen`

const METRIC_COLUMNS = [
  'queries',
  'errors',
  'p95_ms',
  'readable_bytes_read',
  'peak_memory',
  'last_seen',
]

const METRIC_FORMATS: QueryConfig['columnFormats'] = {
  queries: ColumnFormat.BackgroundBar,
  errors: ColumnFormat.Number,
  readable_bytes_read: ColumnFormat.BackgroundBar,
  last_seen: ColumnFormat.RelatedTime,
}

/** One breakdown table per attribution field. */
const BREAKDOWNS = [
  {
    key: 'user',
    label: 'signed-in user',
    empty: '(anonymous or cron)',
  },
  {
    key: 'source',
    label: 'source (chart, table, console, agent, cron job)',
    empty: '(unknown)',
  },
  { key: 'version', label: 'dashboard version', empty: '(unknown)' },
  { key: 'label', label: 'deployment label', empty: '(no label)' },
] as const

function breakdownConfig({
  key,
  label,
  empty,
}: (typeof BREAKDOWNS)[number]): QueryConfig {
  // `user` is a query_log column; the output must not shadow it.
  const alias = key === 'user' ? 'dashboard_user' : key
  return {
    name: `dashboard-usage-by-${key}`,
    permission: { feature: 'operations' },
    defaultView: 'table',
    card: { primary: alias },
    description: `Queries this dashboard sent, by ${label}: count, errors, p95 duration, bytes read, peak memory (top 100, default 7 days, at most 30). THIS REPLICA ONLY.`,
    docs: QUERY_LOG,
    tableCheck: 'system.query_log',
    sql: `
      SELECT
          if(${attr(key)} = '', '${empty}', ${attr(key)}) AS ${alias},${
            key === 'user'
              ? `
          encodeURLComponent(any(${attr('user')})) AS user_param,`
              : ''
          }${METRICS},
          round(queries * 100.0 / nullIf(max(queries) OVER (), 0), 2) AS pct_queries,
          round(bytes_read * 100.0 / nullIf(max(bytes_read) OVER (), 0), 2) AS pct_bytes_read
      FROM merge('system', '^query_log')${WHERE}
      GROUP BY ${alias}
      ORDER BY queries DESC
      LIMIT 100`,
    columns: [alias, ...METRIC_COLUMNS],
    columnFormats:
      key === 'user'
        ? {
            ...METRIC_FORMATS,
            dashboard_user: [
              ColumnFormat.Link,
              {
                href: '/dashboard-usage/user?user=[user_param]&days=[ctx.days]&host=[ctx.hostId]',
              },
            ],
          }
        : METRIC_FORMATS,
    defaultParams: DEFAULT_PARAMS,
    filterParamPresets: USAGE_DAYS_PRESETS,
  }
}

export const dashboardUsageBreakdownConfigs: QueryConfig[] =
  BREAKDOWNS.map(breakdownConfig)

export const dashboardUsageDailyConfig: QueryConfig = {
  name: 'dashboard-usage-daily',
  permission: { feature: 'operations' },
  defaultView: 'table',
  card: { primary: 'day' },
  description:
    'Queries this dashboard sent, per day: count, distinct signed-in users, errors, p95 duration, bytes read, peak memory (default 7 days, at most 30). THIS REPLICA ONLY.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          event_date AS day,
          uniqExactIf(${attr('user')}, ${attr('user')} != '') AS users,${METRICS}
      FROM merge('system', '^query_log')${WHERE}
      GROUP BY day
      ORDER BY day DESC
      LIMIT 31`,
  columns: ['day', 'users', ...METRIC_COLUMNS],
  columnFormats: {
    users: ColumnFormat.Number,
    queries: ColumnFormat.Number,
    errors: ColumnFormat.Number,
    last_seen: ColumnFormat.RelatedTime,
  },
  defaultParams: DEFAULT_PARAMS,
  filterParamPresets: USAGE_DAYS_PRESETS,
}

export const dashboardUsageExpensiveConfig: QueryConfig = {
  name: 'dashboard-usage-expensive',
  permission: { feature: 'operations' },
  defaultView: 'table',
  card: { primary: 'query_id' },
  description:
    'The most expensive queries this dashboard sent, by duration, with who and what sent them (top 50, default 7 days, at most 30). THIS REPLICA ONLY.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          query_id,
          encodeURLComponent(query_id) AS query_id_param,
          event_time,
          if(${attr('user')} = '', '(anonymous or cron)', ${attr('user')}) AS dashboard_user,
          ${attr('source')} AS source,
          ${attr('page')} AS page,
          query_duration_ms,
          formatReadableSize(read_bytes) AS readable_read_bytes,
          formatReadableSize(memory_usage) AS readable_memory,
          if(type = 'QueryFinish', '', errorCodeToName(exception_code)) AS error,
          substring(normalizeQuery(query), 1, 300) AS sample
      FROM merge('system', '^query_log')${WHERE}
      ORDER BY query_duration_ms DESC
      LIMIT 50`,
  columns: [
    'query_id',
    'event_time',
    'dashboard_user',
    'source',
    'page',
    'query_duration_ms',
    'readable_read_bytes',
    'readable_memory',
    'error',
    'sample',
  ],
  columnFormats: {
    query_id: [
      ColumnFormat.Link,
      { href: '/query?query_id=[query_id_param]&host=[ctx.hostId]' },
    ],
    event_time: ColumnFormat.RelatedTime,
    query_duration_ms: ColumnFormat.Number,
    sample: ColumnFormat.Code,
  },
  defaultParams: DEFAULT_PARAMS,
  filterParamPresets: USAGE_DAYS_PRESETS,
}

/**
 * One-row totals for the KPI tiles. `email` is filled only for a single
 * dashboard user and only when a record carried it: the encoder writes it to
 * `log_comment` alone, and only when the operator opted in.
 */
export const dashboardUsageSummaryConfig: QueryConfig = {
  name: 'dashboard-usage-summary',
  permission: { feature: 'operations' },
  defaultView: 'table',
  description:
    'Totals of the queries this dashboard sent: queries, distinct signed-in users, error rate, p95 duration, bytes read (default 7 days, at most 30). THIS REPLICA ONLY.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          count() AS queries,
          uniqExactIf(${attr('user')}, ${attr('user')} != '') AS users,
          countIf(type != 'QueryFinish') AS errors,
          round(errors * 100.0 / nullIf(queries, 0), 2) AS error_pct,
          round(quantile(0.95)(query_duration_ms)) AS p95_ms,
          formatReadableSize(sum(read_bytes)) AS readable_bytes_read,
          if({dashboard_user:String} = '', '',
             anyIf(JSONExtractString(log_comment, 'email'), JSONExtractString(log_comment, 'email') != '')) AS email,
          least({days:UInt16}, ${USAGE_MAX_DAYS}) AS window_days
      FROM merge('system', '^query_log')${WHERE}`,
  columns: [
    'queries',
    'users',
    'errors',
    'error_pct',
    'p95_ms',
    'readable_bytes_read',
    'email',
    'window_days',
  ],
  defaultParams: DEFAULT_PARAMS,
}

/** One dashboard user's latest queries, normalized (literals become `?`). */
export const dashboardUsageRecentConfig: QueryConfig = {
  name: 'dashboard-usage-recent',
  permission: { feature: 'operations' },
  defaultView: 'table',
  card: { primary: 'sample' },
  description:
    'Latest queries this dashboard sent for the user, normalized so literal values are hidden (100 rows, default 7 days, at most 30). THIS REPLICA ONLY.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          query_id,
          encodeURLComponent(query_id) AS query_id_param,
          event_time,
          ${attr('source')} AS source,
          ${attr('page')} AS page,
          query_duration_ms,
          formatReadableSize(read_bytes) AS readable_read_bytes,
          if(type = 'QueryFinish', '', errorCodeToName(exception_code)) AS error,
          substring(normalizeQuery(query), 1, 300) AS sample
      FROM merge('system', '^query_log')${WHERE}
      ORDER BY event_time DESC
      LIMIT 100`,
  columns: [
    'event_time',
    'source',
    'page',
    'query_duration_ms',
    'readable_read_bytes',
    'error',
    'sample',
    'query_id',
  ],
  columnFormats: {
    query_id: [
      ColumnFormat.Link,
      { href: '/query?query_id=[query_id_param]&host=[ctx.hostId]' },
    ],
    event_time: ColumnFormat.RelatedTime,
    query_duration_ms: ColumnFormat.Number,
    sample: ColumnFormat.Code,
  },
  defaultParams: DEFAULT_PARAMS,
  filterParamPresets: USAGE_DAYS_PRESETS,
}

/** Failed dashboard queries grouped by error and query shape. */
export const dashboardUsageErrorsConfig: QueryConfig = {
  name: 'dashboard-usage-errors',
  permission: { feature: 'operations' },
  defaultView: 'table',
  card: { primary: 'error' },
  description:
    'Failed queries this dashboard sent, by error and normalized query shape (top 50, default 7 days, at most 30). THIS REPLICA ONLY.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          errorCodeToName(exception_code) AS error,
          any(${attr('source')}) AS source,
          count() AS failures,
          max(event_time) AS last_seen,
          substring(any(normalizeQuery(query)), 1, 300) AS sample,
          substring(any(exception), 1, 300) AS message
      FROM merge('system', '^query_log')${WHERE}
        AND type != 'QueryFinish'
      GROUP BY error, normalized_query_hash
      ORDER BY failures DESC, last_seen DESC
      LIMIT 50`,
  columns: ['error', 'source', 'failures', 'last_seen', 'message', 'sample'],
  columnFormats: {
    failures: ColumnFormat.Number,
    last_seen: ColumnFormat.RelatedTime,
    sample: ColumnFormat.Code,
  },
  defaultParams: DEFAULT_PARAMS,
  filterParamPresets: USAGE_DAYS_PRESETS,
}

/** The tables on the global Dashboard Usage page, in page order. */
export const dashboardUsageConfigs: QueryConfig[] = [
  dashboardUsageDailyConfig,
  ...dashboardUsageBreakdownConfigs,
  dashboardUsageExpensiveConfig,
]

/** Every dashboard usage config, for the central registry. */
export const allDashboardUsageConfigs: QueryConfig[] = [
  dashboardUsageSummaryConfig,
  ...dashboardUsageConfigs,
  dashboardUsageRecentConfig,
  dashboardUsageErrorsConfig,
]
