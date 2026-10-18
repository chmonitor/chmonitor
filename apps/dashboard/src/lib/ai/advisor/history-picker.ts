/**
 * Parameterized `system.query_log` lookup for the Query Advisor history picker.
 * Free-text/user/kind values are bound as `{param:Type}` query parameters; the
 * numeric knobs are clamped to safe integers and inlined, like `buildTimeFilter`
 * in `lib/clickhouse-query.ts`. Pure (no I/O).
 */

import { QUERY_COMMENT } from '@chm/clickhouse-client/constants' // pragma: allowlist secret

export const HISTORY_PICKER_KINDS = [
  'Select',
  'Insert',
  'Create',
  'Alter',
  'Drop',
  'System',
] as const
export type HistoryPickerKind = (typeof HISTORY_PICKER_KINDS)[number]

export const HISTORY_PICKER_KIND_ALL = 'all' as const
export type HistoryPickerKindFilter =
  | HistoryPickerKind
  | typeof HISTORY_PICKER_KIND_ALL

export const HISTORY_PICKER_KIND_OPTIONS: ReadonlyArray<{
  value: HistoryPickerKindFilter
  label: string
}> = [
  { value: HISTORY_PICKER_KIND_ALL, label: 'All kinds' },
  { value: 'Select', label: 'Select' },
  { value: 'Insert', label: 'Insert' },
  { value: 'Create', label: 'Create' },
  { value: 'Alter', label: 'Alter' },
  { value: 'Drop', label: 'Drop' },
  { value: 'System', label: 'System' },
]

/**
 * Distinctive prefix `fetchData` prepends to every dashboard query. Trimmed so
 * the match is independent of how query_log stores whitespace after the block
 * comment.
 */
export const DASHBOARD_QUERY_FINGERPRINT = QUERY_COMMENT.trim() // pragma: allowlist secret

export interface HistoryPickerFilters {
  keyword?: string
  user?: string
  /** Unset / `'all'` means no kind predicate; do not default to Select. */
  kind?: HistoryPickerKindFilter
  minDurationMs?: number
  hours?: number
  limit?: number
  /** Default true: drop queries carrying the dashboard `QUERY_COMMENT` fingerprint. */
  excludeSelf?: boolean
}

export interface HistoryQueryRow {
  query_id: string
  query: string
  user: string
  query_duration_ms: number
  event_time: string
  read_rows: number
}

export const HISTORY_PICKER_MAX_LIMIT = 50
export const HISTORY_PICKER_DEFAULT_LIMIT = 50
export const HISTORY_PICKER_DEFAULT_HOURS = 24
/** Widest window the picker allows, so the scan stays bounded. */
const HISTORY_PICKER_MAX_HOURS = 24 * 30 // 30 days

function clampInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  const n = Math.floor(value)
  if (n < min) return min
  if (n > max) return max
  return n
}

export interface BuiltHistoryQuery {
  sql: string
  params: Record<string, string>
}

function isHistoryPickerKind(value: string): value is HistoryPickerKind {
  return (HISTORY_PICKER_KINDS as readonly string[]).includes(value)
}

/**
 * Results are ordered by `query_duration_ms DESC`, grouped by `query_id`. ORMs
 * and clients that reuse ids are not collapsed by normalized text; that would
 * be a separate product decision.
 */
export function buildHistoryPickerQuery(
  filters: HistoryPickerFilters = {}
): BuiltHistoryQuery {
  const hours = clampInt(
    filters.hours,
    HISTORY_PICKER_DEFAULT_HOURS,
    1,
    HISTORY_PICKER_MAX_HOURS
  )
  const limit = clampInt(
    filters.limit,
    HISTORY_PICKER_DEFAULT_LIMIT,
    1,
    HISTORY_PICKER_MAX_LIMIT
  )
  const minDurationMs = clampInt(
    filters.minDurationMs,
    0,
    0,
    Number.MAX_SAFE_INTEGER
  )

  const params: Record<string, string> = {}
  const where: string[] = [
    "type = 'QueryFinish'",
    `event_time >= now() - INTERVAL ${hours} HOUR`,
  ]

  const keyword = filters.keyword?.trim()
  if (keyword) {
    params.keyword = keyword
    where.push('positionCaseInsensitiveUTF8(query, {keyword:String}) > 0')
  }

  const user = filters.user?.trim()
  if (user) {
    params.user = user
    where.push('user = {user:String}')
  }

  const kind = filters.kind
  if (kind && kind !== HISTORY_PICKER_KIND_ALL && isHistoryPickerKind(kind)) {
    params.kind = kind
    where.push('query_kind = {kind:String}')
  }

  const excludeSelf = filters.excludeSelf !== false
  if (excludeSelf && DASHBOARD_QUERY_FINGERPRINT !== '') {
    params.selfFingerprint = DASHBOARD_QUERY_FINGERPRINT // pragma: allowlist secret
    where.push('position(query, {selfFingerprint:String}) = 0')
  }

  if (minDurationMs > 0) {
    where.push(`query_duration_ms >= ${minDurationMs}`)
  }

  // Filter in a CTE, then aggregate. The analyzer substitutes SELECT
  // aliases into WHERE when they share a column name — so
  // `max(event_time) AS event_time` + `WHERE event_time >= …` (and the
  // same for `user` / `query_duration_ms`) raises ILLEGAL_AGGREGATION
  // (code 184). Keeping WHERE on the un-aggregated scan avoids that.
  const sql = `
    WITH filtered AS (
      SELECT
        query_id,
        query,
        user,
        query_duration_ms,
        event_time,
        read_rows
      FROM system.query_log
      WHERE ${where.join('\n        AND ')}
    )
    SELECT
      query_id,
      any(query) AS query,
      any(user) AS user,
      max(query_duration_ms) AS query_duration_ms,
      max(event_time) AS event_time,
      max(read_rows) AS read_rows
    FROM filtered
    GROUP BY query_id
    ORDER BY query_duration_ms DESC
    LIMIT ${limit}
  `.trim()

  return { sql, params }
}

export function buildHistoryUsersQuery(hours?: number): BuiltHistoryQuery {
  const h = clampInt(
    hours,
    HISTORY_PICKER_DEFAULT_HOURS,
    1,
    HISTORY_PICKER_MAX_HOURS
  )
  const sql = `
    SELECT DISTINCT user
    FROM system.query_log
    WHERE event_time >= now() - INTERVAL ${h} HOUR
      AND user != ''
    ORDER BY user
    LIMIT ${HISTORY_PICKER_MAX_LIMIT}
  `.trim()
  return { sql, params: {} }
}

export function truncateQueryText(query: string, max = 120): string {
  const normalized = query.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max).trimEnd()}…`
}
