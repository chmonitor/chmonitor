import type { QueryConfig } from '@/types/query-config'

import { USAGE_END_EVENTS } from '@/lib/query-config/queries/usage'
import { QUERY_LOG } from '@/lib/table-notes'

/**
 * Data for one expanded row on `/users`. Each config filters on
 * `user = {user:String}`, so a fetch only ever reads the opened user, and
 * every scan is bounded on `event_date` for partition pruning. Query kinds,
 * roles and profiles reuse `user-usage-kinds` and `user-usage-profile`.
 */

const USER_FILTER = 'user = {user:String}'

export const userDetailSummaryConfig: QueryConfig = {
  name: 'user-detail-summary',
  permission: { feature: 'queries' },
  description:
    "This user's last 7 days on this replica: queries, failed queries, bytes read and p95 memory per query.",
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          count() AS queries,
          countIf(type != 'QueryFinish') AS errors,
          formatReadableSize(sum(read_bytes)) AS readable_read_bytes,
          formatReadableSize(if(queries = 0, 0, quantile(0.95)(memory_usage))) AS readable_memory_p95
      FROM merge('system', '^query_log')
      WHERE (${USER_FILTER})
        AND (${USAGE_END_EVENTS})
        AND (event_date >= today() - 7)
        AND (event_time >= now() - INTERVAL 7 DAY)
      LIMIT 1`,
  columns: ['queries', 'errors', 'readable_read_bytes', 'readable_memory_p95'],
  defaultParams: { user: '' },
}

/**
 * The 5 latest queries as normalized shapes (`normalizeQuery` replaces every
 * literal, and exists on every supported version). The raw text never leaves
 * the inner subquery, and only those 5 rows are normalized.
 */
export const userDetailRecentConfig: QueryConfig = {
  name: 'user-detail-recent',
  permission: { feature: 'queries' },
  description:
    "This user's 5 latest finished or failed queries in the last 7 days, literals replaced. THIS REPLICA ONLY.",
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          recent.event_time AS event_time,
          recent.query_duration_ms AS query_duration_ms,
          toString(recent.type) AS status,
          if(toString(recent.query_kind) = '', 'Unknown', toString(recent.query_kind)) AS kind,
          substring(normalizeQuery(recent.query), 1, 300) AS query_shape
      FROM
      (
          SELECT event_time, query_duration_ms, type, query_kind, query
          FROM merge('system', '^query_log')
          WHERE (${USER_FILTER})
            AND (${USAGE_END_EVENTS})
            AND (event_date >= today() - 7)
          ORDER BY event_time DESC
          LIMIT 5
      ) AS recent
      ORDER BY event_time DESC`,
  columns: ['event_time', 'query_duration_ms', 'status', 'kind', 'query_shape'],
  defaultParams: { user: '' },
}

/** 24 hourly buckets ending with the current hour; empty hours are 0. */
export const userDetailHourlyConfig: QueryConfig = {
  name: 'user-detail-hourly',
  permission: { feature: 'queries' },
  description:
    "This user's queries per hour over the last 24 hours. THIS REPLICA ONLY.",
  docs: QUERY_LOG,
  tableCheck: 'system.query_log',
  sql: `
      SELECT
          toStartOfHour(event_time) AS hour,
          count() AS queries
      FROM merge('system', '^query_log')
      WHERE (${USER_FILTER})
        AND (${USAGE_END_EVENTS})
        AND (event_date >= yesterday())
        AND (event_time >= toStartOfHour(now()) - INTERVAL 23 HOUR)
      GROUP BY hour
      ORDER BY hour ASC WITH FILL
          FROM toStartOfHour(now()) - INTERVAL 23 HOUR
          TO toStartOfHour(now()) + INTERVAL 1 HOUR
          STEP INTERVAL 1 HOUR`,
  columns: ['hour', 'queries'],
  defaultParams: { user: '' },
}

export const userDetailLoginConfig: QueryConfig = {
  name: 'user-detail-login',
  permission: { feature: 'security' },
  optional: true,
  description:
    "This user's latest successful login in the last 30 days (system.session_log): time, client address and interface.",
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/session_log',
  tableCheck: 'system.session_log',
  sql: `
      SELECT
          event_time AS last_login,
          toString(client_address) AS client_address,
          toString(interface) AS interface
      FROM merge('system', '^session_log')
      WHERE (${USER_FILTER})
        AND (type = 'LoginSuccess')
        AND (event_date >= today() - 30)
      ORDER BY event_time DESC
      LIMIT 1`,
  columns: ['last_login', 'client_address', 'interface'],
  defaultParams: { user: '' },
}

export const userDetailConfigs: QueryConfig[] = [
  userDetailSummaryConfig,
  userDetailRecentConfig,
  userDetailHourlyConfig,
  userDetailLoginConfig,
]
