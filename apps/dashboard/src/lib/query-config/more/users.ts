import type { QueryConfig, VersionedSql } from '@/types/query-config'

import { createUserExpandedDetails } from '@/components/users/create-user-expanded-details'
import { EXPIRY_TONES, STATUS_TONES } from '@/components/users/user-status'
import { USAGE_END_EVENTS } from '@/lib/query-config/queries/usage'
import { ColumnFormat } from '@/types/column-format'

/**
 * Security > Users (`/users`). One row per `system.users` account, joined to
 * one aggregate of this replica's query log (last 7 days) and, when
 * `system.session_log` exists, the last successful login (last 30 days).
 *
 * Both log tables are optional in ClickHouse and `merge()` throws when no
 * table matches, so the page picks one of three variants by table
 * availability (`pickUsersConfig`) instead of failing the whole list.
 */

/** Activity window (days) for the list counts and the status badge. */
export const USERS_ACTIVITY_DAYS = 7

/** Window (days) searched for the last successful login. */
export const USERS_LOGIN_DAYS = 30

/**
 * First release whose `system.users` has `valid_until` (`Array(DateTime)`,
 * one entry per authentication method). Older servers get placeholders.
 */
export const USERS_VALID_UNTIL_SINCE = '26.2'

export interface UsersVariant {
  /** `system.query_log` exists: activity counts, status, last query. */
  activity: boolean
  /** `system.session_log` exists: last successful login. */
  login: boolean
}

// An epoch entry means "no expiry" for that auth method, so any epoch entry
// means the account never expires. The lambda stays inline: a WITH alias is
// invisible to the old analyzer outside SELECT.
const VALID_UNTIL_SQL = `
    if(empty(u.valid_until) OR has(arrayMap(t -> toUnixTimestamp(t), u.valid_until), 0), NULL, arrayMax(u.valid_until)) AS valid_until_at,
    ifNull(toString(valid_until_at), 'never') AS valid_until,
    multiIf(valid_until_at IS NULL, 'never', valid_until_at < now(), 'expired', valid_until_at < now() + INTERVAL 7 DAY, 'expiring', 'valid') AS expiry_status,`

const NO_VALID_UNTIL_SQL = `
    '' AS valid_until,
    '' AS expiry_status,`

const ACTIVITY_SQL = `
    multiIf(a.queries_7d = 0, 'inactive', a.last_query_time >= now() - INTERVAL 1 HOUR, 'active', 'idle') AS status,
    a.queries_24h AS queries_24h,
    a.queries_7d AS queries_7d,
    round(a.queries_7d * 100.0 / nullIf(max(a.queries_7d) OVER (), 0), 2) AS pct_queries_7d,
    a.errors_7d AS errors_7d,
    nullIf(a.last_query_time, toDateTime(0)) AS last_query_time,`

const ACTIVITY_JOIN = `
LEFT JOIN
(
    SELECT
        user,
        countIf(event_time >= now() - INTERVAL 1 DAY) AS queries_24h,
        count() AS queries_7d,
        countIf(type != 'QueryFinish') AS errors_7d,
        max(event_time) AS last_query_time
    FROM merge('system', '^query_log')
    WHERE (${USAGE_END_EVENTS})
      AND (event_date >= today() - ${USERS_ACTIVITY_DAYS})
      AND (event_time >= now() - INTERVAL ${USERS_ACTIVITY_DAYS} DAY)
    GROUP BY user
) AS a ON a.user = u.name`

const LOGIN_SQL = `
    nullIf(l.last_login, toDateTime(0)) AS last_login,`

const LOGIN_JOIN = `
LEFT JOIN
(
    SELECT
        user,
        max(event_time) AS last_login
    FROM merge('system', '^session_log')
    WHERE (type = 'LoginSuccess')
      AND (event_date >= today() - ${USERS_LOGIN_DAYS})
    GROUP BY user
) AS l ON l.user = u.name`

function buildUsersSql(variant: UsersVariant, validUntil: boolean): string {
  return `
SELECT
    u.name AS name,
    encodeURLComponent(u.name) AS name_param,${variant.activity ? ACTIVITY_SQL : ''}${variant.login ? LOGIN_SQL : ''}${validUntil ? VALID_UNTIL_SQL : NO_VALID_UNTIL_SQL}
    u.storage AS storage,
    u.auth_type AS auth_type,
    u.auth_params AS auth_params,
    u.host_ip AS host_ip,
    u.host_names AS host_names,
    u.default_roles_all AS default_roles_all,
    u.default_roles_list AS default_roles_list,
    u.default_roles_except AS default_roles_except,
    u.default_database AS default_database
FROM system.users AS u${variant.activity ? ACTIVITY_JOIN : ''}${variant.login ? LOGIN_JOIN : ''}
ORDER BY ${variant.activity ? 'queries_7d DESC, ' : ''}name
LIMIT 1000`
}

function buildUsersColumns(variant: UsersVariant): string[] {
  return [
    'name',
    ...(variant.activity
      ? ['status', 'queries_24h', 'queries_7d', 'errors_7d', 'last_query_time']
      : []),
    ...(variant.login ? ['last_login'] : []),
    'expiry_status',
    'valid_until',
    'storage',
    'auth_type',
    'auth_params',
    'host_ip',
    'host_names',
    'default_roles_all',
    'default_roles_list',
    'default_roles_except',
    'default_database',
  ]
}

const USERS_COLUMN_FORMATS: NonNullable<QueryConfig['columnFormats']> = {
  name: [
    ColumnFormat.Link,
    { href: '/usage/user?user=[name_param]&host=[ctx.hostId]' },
  ],
  status: [ColumnFormat.ColoredBadge, { valueClassNames: STATUS_TONES }],
  queries_24h: ColumnFormat.Number,
  queries_7d: ColumnFormat.BackgroundBar,
  errors_7d: ColumnFormat.Number,
  last_query_time: ColumnFormat.RelatedTime,
  last_login: ColumnFormat.RelatedTime,
  expiry_status: [ColumnFormat.ColoredBadge, { valueClassNames: EXPIRY_TONES }],
}

const USERS_COLUMN_DESCRIPTIONS: Record<string, string> = {
  status: `active: a query in the last hour. idle: a query in the last ${USERS_ACTIVITY_DAYS} days. inactive: no query in ${USERS_ACTIVITY_DAYS} days on this replica.`,
  queries_24h: 'Finished and failed queries in the last 24 hours.',
  queries_7d: `Finished and failed queries in the last ${USERS_ACTIVITY_DAYS} days.`,
  errors_7d: `Failed queries in the last ${USERS_ACTIVITY_DAYS} days.`,
  last_login: `Latest successful login in the last ${USERS_LOGIN_DAYS} days.`,
  expiry_status:
    'never: no expiry. expiring: within 7 days. Empty on servers without system.users.valid_until.',
}

/** Keep only the entries for columns this variant selects. */
function pickColumns<T>(
  map: Partial<Record<string, T>>,
  columns: string[]
): Record<string, T> {
  return Object.fromEntries(
    columns.flatMap((c) => (map[c] === undefined ? [] : [[c, map[c] as T]]))
  )
}

function buildUsersConfig(name: string, variant: UsersVariant): QueryConfig {
  const sql: VersionedSql[] = [
    { since: '23.8', sql: buildUsersSql(variant, false) },
    { since: USERS_VALID_UNTIL_SINCE, sql: buildUsersSql(variant, true) },
  ]
  const columns = buildUsersColumns(variant)
  const tableCheck = [
    'system.users',
    ...(variant.activity ? ['system.query_log'] : []),
    ...(variant.login ? ['system.session_log'] : []),
  ]

  return {
    name,
    permission: { feature: 'security' },
    defaultView: 'auto',
    card: {
      primary: 'name',
      badges: variant.activity
        ? ['status', 'expiry_status']
        : ['expiry_status'],
    },
    description: [
      'ClickHouse user accounts.',
      variant.activity
        ? `Activity is the last ${USERS_ACTIVITY_DAYS} days of this replica's query log: active means a query in the last hour, inactive means none in ${USERS_ACTIVITY_DAYS} days.`
        : 'system.query_log is missing on this host, so activity columns are hidden.',
      variant.login
        ? `Last login is the latest LoginSuccess in system.session_log (last ${USERS_LOGIN_DAYS} days).`
        : '',
      'valid_until "never" means the account does not expire.',
    ]
      .filter(Boolean)
      .join(' '),
    tableCheck: tableCheck.length === 1 ? tableCheck[0] : tableCheck,
    sql,
    columns,
    columnFormats: pickColumns(USERS_COLUMN_FORMATS, columns),
    columnDescriptions: pickColumns(USERS_COLUMN_DESCRIPTIONS, columns),
    expandable: {
      renderExpanded: createUserExpandedDetails(),
    },
  }
}

/** Full list: query log activity plus last login. */
export const usersWithLoginConfig = buildUsersConfig('users-with-login', {
  activity: true,
  login: true,
})

/** Default list: query log activity, no session log. */
export const usersConfig = buildUsersConfig('users', {
  activity: true,
  login: false,
})

/** Fallback when this host has no query log: accounts only. */
export const usersBasicConfig = buildUsersConfig('users-basic', {
  activity: false,
  login: false,
})

/** Variant for the tables this host really has. */
export function pickUsersConfig(variant: UsersVariant): QueryConfig {
  if (!variant.activity) return usersBasicConfig
  return variant.login ? usersWithLoginConfig : usersConfig
}
