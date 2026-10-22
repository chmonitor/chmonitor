import type { QueryConfig } from '@/types/query-config'

import { QUERY_LOG } from '@/lib/table-notes'
import { ColumnFormat } from '@/types/column-format'

/**
 * Usage across users (#4125), from this replica's query log.
 *
 * Scans are bounded: `days` defaults to 7 and is capped in SQL with
 * `least(...)`, because URL search params reach ClickHouse unchanged
 * (`lib/api/table-registry.ts`), so a preset list alone caps nothing. The
 * bound is on `event_date` for partition pruning. Only end events are
 * counted, so a query's QueryStart row is never counted twice.
 */

/** Max window for the per-user aggregate tables. */
export const USAGE_MAX_DAYS = 30

/** The end-event filter shared by every usage config. */
export const USAGE_END_EVENTS =
  "type IN ('QueryFinish', 'ExceptionBeforeStart', 'ExceptionWhileProcessing')"

/** `event_date` bound shared by every aggregate usage config. */
export const USAGE_DATE_BOUND = `event_date >= today() - least({days:UInt16}, ${USAGE_MAX_DAYS})`

/**
 * Service accounts hidden by the "Hide system users" toggle: the same
 * `CLICKHOUSE_EXCLUDE_USER_DEFAULT` list history-queries excludes by default,
 * plus the empty user name. Read on the server, where the SQL is built.
 */
export const USAGE_SYSTEM_USERS =
  process.env.CLICKHOUSE_EXCLUDE_USER_DEFAULT || ''

/**
 * `/usage` list filters, all bound params: a case-insensitive substring on the
 * user name (not LIKE, so `%` and `_` match literally) and the system-user
 * toggle. `column` is `user` in query_log and `name` in system.users.
 */
export const usageUserFilters = (column: string) =>
  `({name_filter:String} = '' OR positionCaseInsensitive(${column}, {name_filter:String}) > 0)
        AND ({hide_system:String} != '1' OR NOT has(arrayMap(x -> trimBoth(x), splitByChar(',', {system_users:String})), ${column}))`

/** Defaults for the `/usage` list filters: every param must be bound. */
export const USAGE_FILTER_DEFAULTS = {
  name_filter: '',
  hide_system: '',
  system_users: USAGE_SYSTEM_USERS,
}

/**
 * The `/usage` URL params forwarded to both tables. `system_users` is not
 * forwarded: the server's own default (the env list) applies.
 */
export function usageListSearchParams(url: {
  get(key: string): string | null
}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ['days', 'name_filter', 'hide_system']) {
    const value = url.get(key)
    if (value) out[key] = value
  }
  return out
}

export const USAGE_DAYS_PRESETS: NonNullable<
  QueryConfig['filterParamPresets']
> = [
  { name: 'Last 7d', key: 'days', value: '7' },
  { name: 'Last 30d', key: 'days', value: '30' },
]

/** `/usage` presets: the window plus the system-user toggle. */
export const USAGE_LIST_PRESETS: NonNullable<
  QueryConfig['filterParamPresets']
> = [
  ...USAGE_DAYS_PRESETS,
  { name: 'Hide system users', key: 'hide_system', value: '1' },
]

export const usageByUserConfig: QueryConfig = {
  name: 'usage-by-user',
  permission: { feature: 'queries' },
  defaultView: 'auto',
  card: { primary: 'user' },
  description:
    'One row per user that ran a query in the window (default 7 days, at most 30): queries, failures, p50/p95 duration, rows and bytes read, CPU time, peak memory, distinct tables, first and last seen. Filter by name, or hide the service users listed in CLICKHOUSE_EXCLUDE_USER_DEFAULT (and the empty internal user). Click a user for the detail view. THIS REPLICA ONLY: queries served by another replica are not counted.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          user,
          encodeURLComponent(user) AS user_param,
          count() AS queries,
          countIf(type != 'QueryFinish') AS failed,
          round(failed * 100.0 / nullIf(queries, 0), 2) AS failed_pct,
          round(quantile(0.5)(query_duration_ms)) AS p50_ms,
          round(quantile(0.95)(query_duration_ms)) AS p95_ms,
          sum(read_rows) AS rows_read,
          sum(read_bytes) AS bytes_read,
          formatReadableSize(bytes_read) AS readable_bytes_read,
          round(bytes_read * 100.0 / nullIf(max(bytes_read) OVER (), 0), 2) AS pct_bytes_read,
          round(sum(ProfileEvents['UserTimeMicroseconds'] + ProfileEvents['SystemTimeMicroseconds']) / 1000000, 2) AS cpu_seconds,
          formatReadableSize(max(memory_usage)) AS peak_memory,
          uniqExactArray(tables) AS tables_touched,
          min(event_time) AS first_seen,
          max(event_time) AS last_seen
      FROM merge('system', '^query_log')
      WHERE (${USAGE_END_EVENTS})
        AND (${USAGE_DATE_BOUND})
        AND ${usageUserFilters('user')}
      GROUP BY user
      ORDER BY queries DESC
      LIMIT 500`,
  columns: [
    'user',
    'queries',
    'failed',
    'failed_pct',
    'p50_ms',
    'p95_ms',
    'rows_read',
    'readable_bytes_read',
    'cpu_seconds',
    'peak_memory',
    'tables_touched',
    'first_seen',
    'last_seen',
  ],
  columnFormats: {
    user: [
      ColumnFormat.Link,
      { href: '/usage/user?user=[user_param]&host=[ctx.hostId]' },
    ],
    queries: ColumnFormat.Number,
    failed: ColumnFormat.Number,
    rows_read: ColumnFormat.Number,
    readable_bytes_read: ColumnFormat.BackgroundBar,
    first_seen: ColumnFormat.RelatedTime,
    last_seen: ColumnFormat.RelatedTime,
  },
  defaultParams: { days: '7', ...USAGE_FILTER_DEFAULTS },
  filterParamPresets: USAGE_LIST_PRESETS,
}

/**
 * Users defined in system.users with no query in the window. `NOT IN` a
 * subquery (not a JOIN) behaves the same under both analyzers. External
 * (LDAP) users are absent from system.users until they log in, so they never
 * appear here.
 */
export const usageInactiveUsersConfig: QueryConfig = {
  name: 'usage-inactive-users',
  permission: { feature: 'queries' },
  defaultView: 'auto',
  card: { primary: 'name' },
  description:
    'Users in system.users with no finished or failed query in the window (default 7 days, at most 30). THIS REPLICA ONLY: a user active only on another replica is listed here. No judgement is made.',
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          name,
          storage
      FROM system.users
      WHERE name NOT IN (
          SELECT DISTINCT user
          FROM merge('system', '^query_log')
          WHERE (${USAGE_END_EVENTS})
            AND (${USAGE_DATE_BOUND})
      )
        AND ${usageUserFilters('name')}
      ORDER BY name
      LIMIT 500`,
  columns: ['name', 'storage'],
  defaultParams: { days: '7', ...USAGE_FILTER_DEFAULTS },
  filterParamPresets: USAGE_LIST_PRESETS,
}
