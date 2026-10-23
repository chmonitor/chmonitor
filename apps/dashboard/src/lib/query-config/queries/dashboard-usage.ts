import type { QueryConfig } from '@/types/query-config'

import { USAGE_DATE_BOUND, USAGE_DAYS_PRESETS, USAGE_END_EVENTS } from './usage'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Dashboard usage (#4164): what this dashboard itself sent to ClickHouse, read
 * back from the attribution record on each query (`packages/clickhouse-client
 * /src/attribution`). The record arrives in one of two carriers:
 *
 * - `log_comment` JSON (`{"app":"chmonitor","v":1,"user":…}`), the default;
 * - a leading `/* chmonitor v=1 user=… source=… *\/` SQL comment, sent when
 *   the operator turns it on or when a `readonly = 1` profile refuses
 *   `log_comment`.
 *
 * `attr()` reads the JSON first and falls back to the comment. `[*]` matches
 * a literal star without a backslash, so the regex survives both the TS
 * template and the ClickHouse string literal unchanged.
 */

const IS_JSON_RECORD = `JSONExtractString(log_comment, 'app') = 'chmonitor'`
const IS_COMMENT_RECORD = `startsWith(query, '/* chmonitor ')`

function attr(key: string): string {
  return `if(${IS_JSON_RECORD}, JSONExtractString(log_comment, '${key}'), extract(query, '^/[*] chmonitor [^*]* ${key}=([^ *]+)'))`
}

const DASHBOARD_FILTER = `(${IS_JSON_RECORD} OR ${IS_COMMENT_RECORD})`

const WHERE = `
      WHERE (${USAGE_END_EVENTS})
        AND (${USAGE_DATE_BOUND})
        AND ${DASHBOARD_FILTER}`

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
    permission: { feature: 'queries' },
    defaultView: 'table',
    card: { primary: alias },
    description: `Queries this dashboard sent, by ${label}: count, errors, p95 duration, bytes read, peak memory (top 100, default 7 days, at most 30). THIS REPLICA ONLY.`,
    docs: QUERY_LOG,
    tableCheck: 'system.query_log',
    sql: `
      SELECT
          if(${attr(key)} = '', '${empty}', ${attr(key)}) AS ${alias},${METRICS},
          round(queries * 100.0 / nullIf(max(queries) OVER (), 0), 2) AS pct_queries,
          round(bytes_read * 100.0 / nullIf(max(bytes_read) OVER (), 0), 2) AS pct_bytes_read
      FROM merge('system', '^query_log')${WHERE}
      GROUP BY ${alias}
      ORDER BY queries DESC
      LIMIT 100`,
    columns: [alias, ...METRIC_COLUMNS],
    columnFormats: METRIC_FORMATS,
    defaultParams: { days: '7' },
    filterParamPresets: USAGE_DAYS_PRESETS,
  }
}

export const dashboardUsageBreakdownConfigs: QueryConfig[] =
  BREAKDOWNS.map(breakdownConfig)

export const dashboardUsageDailyConfig: QueryConfig = {
  name: 'dashboard-usage-daily',
  permission: { feature: 'queries' },
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
  defaultParams: { days: '7' },
  filterParamPresets: USAGE_DAYS_PRESETS,
}

export const dashboardUsageExpensiveConfig: QueryConfig = {
  name: 'dashboard-usage-expensive',
  permission: { feature: 'queries' },
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
  defaultParams: { days: '7' },
  filterParamPresets: USAGE_DAYS_PRESETS,
}

export const dashboardUsageConfigs: QueryConfig[] = [
  dashboardUsageDailyConfig,
  ...dashboardUsageBreakdownConfigs,
  dashboardUsageExpensiveConfig,
]
