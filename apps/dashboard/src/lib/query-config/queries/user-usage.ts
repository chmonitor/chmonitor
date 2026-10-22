import type { QueryConfig } from '@/types/query-config'

import { USAGE_DATE_BOUND, USAGE_DAYS_PRESETS, USAGE_END_EVENTS } from './usage'
import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Per-user usage detail (#4125): `/usage/user?user=<name>`. Every config
 * filters on `user = {user:String}` and reads only end events from this
 * replica's query log. The aggregate tables use the shared 30-day cap; the
 * daily activity table returns one row per day, so it alone is allowed a
 * year (`USER_DAILY_MAX_DAYS`).
 */

/** Max window for the one-row-per-day activity table. */
export const USER_DAILY_MAX_DAYS = 365

const USER_FILTER = 'user = {user:String}'

export const userUsageDailyConfig: QueryConfig = {
  name: 'user-usage-daily',
  permission: { feature: 'queries' },
  defaultView: 'table',
  card: { primary: 'day' },
  description:
    "One row per day this user ran a query (default 7 days, at most 365): queries, failures, bytes read, CPU time, p95 duration. Days with no row have no query, or are older than the query log's retention. THIS REPLICA ONLY.",
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          event_date AS day,
          count() AS queries,
          countIf(type != 'QueryFinish') AS failed,
          formatReadableSize(sum(read_bytes)) AS bytes_read,
          round(sum(ProfileEvents['UserTimeMicroseconds'] + ProfileEvents['SystemTimeMicroseconds']) / 1000000, 2) AS cpu_seconds,
          round(quantile(0.95)(query_duration_ms)) AS p95_ms
      FROM merge('system', '^query_log')
      WHERE (${USER_FILTER})
        AND (${USAGE_END_EVENTS})
        AND (event_date >= today() - least({days:UInt16}, ${USER_DAILY_MAX_DAYS}))
      GROUP BY day
      ORDER BY day DESC
      LIMIT ${USER_DAILY_MAX_DAYS + 1}`,
  columns: ['day', 'queries', 'failed', 'bytes_read', 'cpu_seconds', 'p95_ms'],
  columnFormats: {
    queries: ColumnFormat.Number,
    failed: ColumnFormat.Number,
  },
  defaultParams: { user: '', days: '7' },
  filterParamPresets: [
    ...USAGE_DAYS_PRESETS,
    { name: 'Last 1y', key: 'days', value: String(USER_DAILY_MAX_DAYS) },
  ],
}

export const userUsageHoursConfig: QueryConfig = {
  name: 'user-usage-hours',
  permission: { feature: 'queries' },
  defaultView: 'table',
  card: { primary: 'weekday' },
  description:
    'When this user runs queries: query count by weekday (1 = Monday) and hour of day, server time zone (default 7 days, at most 30). THIS REPLICA ONLY.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          toDayOfWeek(event_time) AS weekday,
          toHour(event_time) AS hour,
          count() AS queries,
          round(queries * 100.0 / nullIf(max(queries) OVER (), 0), 2) AS pct_queries
      FROM merge('system', '^query_log')
      WHERE (${USER_FILTER})
        AND (${USAGE_END_EVENTS})
        AND (${USAGE_DATE_BOUND})
      GROUP BY weekday, hour
      ORDER BY weekday, hour
      LIMIT 168`,
  columns: ['weekday', 'hour', 'queries'],
  columnFormats: { queries: ColumnFormat.BackgroundBar },
  defaultParams: { user: '', days: '7' },
  filterParamPresets: USAGE_DAYS_PRESETS,
}

export const userUsageTablesConfig: QueryConfig = {
  name: 'user-usage-tables',
  permission: { feature: 'queries' },
  defaultView: 'table',
  card: { primary: 'table' },
  description:
    'Tables this user read or wrote, by query count (top 50, default 7 days, at most 30). A query on several tables counts once for each. THIS REPLICA ONLY.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          arrayJoin(tables) AS table,
          count() AS queries,
          countIf(query_kind = 'Select') AS selects,
          countIf(query_kind = 'Insert') AS inserts,
          max(event_time) AS last_seen
      FROM merge('system', '^query_log')
      WHERE (${USER_FILTER})
        AND (${USAGE_END_EVENTS})
        AND (${USAGE_DATE_BOUND})
      GROUP BY table
      ORDER BY queries DESC
      LIMIT 50`,
  columns: ['table', 'queries', 'selects', 'inserts', 'last_seen'],
  columnFormats: {
    queries: ColumnFormat.Number,
    last_seen: ColumnFormat.RelatedTime,
  },
  defaultParams: { user: '', days: '7' },
  filterParamPresets: USAGE_DAYS_PRESETS,
}

export const userUsageShapesConfig: QueryConfig = {
  name: 'user-usage-shapes',
  permission: { feature: 'queries' },
  defaultView: 'table',
  card: { primary: 'normalized_query_hash' },
  description:
    "This user's query shapes (normalized_query_hash), by total duration (top 50, default 7 days, at most 30). The sample is the normalized query text (literals replaced), truncated to 300 characters. THIS REPLICA ONLY.",
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          normalized_query_hash,
          any(query_kind) AS kind,
          count() AS executions,
          round(sum(query_duration_ms) / 1000, 2) AS total_seconds,
          round(quantile(0.95)(query_duration_ms)) AS p95_ms,
          formatReadableSize(sum(read_bytes)) AS bytes_read,
          max(event_time) AS last_seen,
          substring(normalizeQuery(any(query)), 1, 300) AS sample
      FROM merge('system', '^query_log')
      WHERE (${USER_FILTER})
        AND (${USAGE_END_EVENTS})
        AND (${USAGE_DATE_BOUND})
      GROUP BY normalized_query_hash
      ORDER BY total_seconds DESC
      LIMIT 50`,
  columns: [
    'normalized_query_hash',
    'kind',
    'executions',
    'total_seconds',
    'p95_ms',
    'bytes_read',
    'last_seen',
    'sample',
  ],
  columnFormats: {
    executions: ColumnFormat.Number,
    last_seen: ColumnFormat.RelatedTime,
    sample: ColumnFormat.Code,
  },
  defaultParams: { user: '', days: '7' },
  filterParamPresets: USAGE_DAYS_PRESETS,
}

export const userUsageErrorsConfig: QueryConfig = {
  name: 'user-usage-errors',
  permission: { feature: 'queries' },
  defaultView: 'table',
  card: { primary: 'exception_code' },
  description:
    "This user's failed queries grouped by exception code, with the latest message truncated to 300 characters and its query id (top 50, default 7 days, at most 30). THIS REPLICA ONLY.",
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          exception_code,
          errorCodeToName(exception_code) AS error_name,
          count() AS failures,
          max(event_time) AS last_seen,
          argMax(query_id, event_time) AS latest_query_id,
          encodeURLComponent(latest_query_id) AS query_id_param,
          substring(argMax(exception, event_time), 1, 300) AS latest_message
      FROM merge('system', '^query_log')
      WHERE (${USER_FILTER})
        AND (type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing'))
        AND (${USAGE_DATE_BOUND})
      GROUP BY exception_code
      ORDER BY failures DESC
      LIMIT 50`,
  columns: [
    'exception_code',
    'error_name',
    'failures',
    'last_seen',
    'latest_query_id',
    'latest_message',
  ],
  columnFormats: {
    failures: ColumnFormat.Number,
    last_seen: ColumnFormat.RelatedTime,
    latest_query_id: [
      ColumnFormat.Link,
      { href: '/query?query_id=[query_id_param]&host=[ctx.hostId]' },
    ],
  },
  defaultParams: { user: '', days: '7' },
  filterParamPresets: USAGE_DAYS_PRESETS,
}

export const userUsageClientsConfig: QueryConfig = {
  name: 'user-usage-clients',
  permission: { feature: 'queries' },
  defaultView: 'table',
  card: { primary: 'client_name' },
  description:
    "Where this user's queries come from: interface, client name, HTTP user agent and client host, by query count (top 50, default 7 days, at most 30). THIS REPLICA ONLY.",
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          interface,
          client_name,
          http_user_agent,
          client_hostname,
          count() AS queries,
          max(event_time) AS last_seen
      FROM merge('system', '^query_log')
      WHERE (${USER_FILTER})
        AND (${USAGE_END_EVENTS})
        AND (${USAGE_DATE_BOUND})
      GROUP BY interface, client_name, http_user_agent, client_hostname
      ORDER BY queries DESC
      LIMIT 50`,
  columns: [
    'interface',
    'client_name',
    'http_user_agent',
    'client_hostname',
    'queries',
    'last_seen',
  ],
  columnFormats: {
    queries: ColumnFormat.Number,
    last_seen: ColumnFormat.RelatedTime,
  },
  defaultParams: { user: '', days: '7' },
  filterParamPresets: USAGE_DAYS_PRESETS,
}

export const userUsageConfigs: QueryConfig[] = [
  userUsageDailyConfig,
  userUsageHoursConfig,
  userUsageTablesConfig,
  userUsageShapesConfig,
  userUsageErrorsConfig,
  userUsageClientsConfig,
]
