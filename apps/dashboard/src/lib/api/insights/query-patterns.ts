/**
 * Query Insights API helpers — list + detail for slow query patterns.
 *
 * Backs `/api/v1/insights/query-patterns` (list) and
 * `/api/v1/insights/query-patterns/$hash` (detail). Reuses the same
 * aggregation SQL as the Slow Query Patterns page
 * (`lib/query-config/queries/slow-query-patterns.ts` `buildQueryPatternsSql`)
 * instead of duplicating the query text — the list config filters by the
 * page's schema-driven filters; the detail config scopes the same
 * aggregation to a single `normalized_query_hash`.
 */

import type { QueryConfig } from '@/lib/query-config'

import { buildQueryPatternsSql } from '@/lib/query-config/queries/slow-query-patterns'

/** `system.query_log` rows contributing to a pattern, individually. */
const EXECUTION_TYPES = "('QueryFinish', 'ExceptionWhileProcessing')"

/** Numeric-string `normalized_query_hash` values only (ClickHouse UInt64). */
const HASH_PATTERN = /^\d{1,20}$/

export function isValidQueryHash(value: string): boolean {
  return HASH_PATTERN.test(value)
}

/**
 * Parse the `range` query param (hours). Falls back to `fallbackHours` when
 * absent/invalid, clamped to `maxHours` so a hand-crafted request cannot force
 * an unbounded `system.query_log` scan.
 */
export function parseRangeHours(
  raw: string | null,
  fallbackHours = 24,
  maxHours = 24 * 90
): number {
  if (!raw) return fallbackHours
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackHours
  // Floor to an integer — this feeds a ClickHouse UInt32 query param, which
  // rejects fractional values (e.g. `?range=1.5` would 500 the query).
  return Math.min(Math.floor(parsed), maxHours)
}

/**
 * Sort pattern rows by a `column[:asc|desc]` spec (default direction: desc,
 * matching the underlying SQL's `ORDER BY total_duration DESC`). Unknown
 * columns are a no-op — the caller gets the SQL's default ordering.
 */
export function sortPatternRows<T extends Record<string, unknown>>(
  rows: T[],
  sortParam: string | null | undefined
): T[] {
  if (!sortParam || rows.length === 0) return rows
  const [column, directionRaw] = sortParam.split(':')
  if (!column || !(column in rows[0])) return rows

  const direction = directionRaw === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = a[column]
    const bv = b[column]
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * direction
    }
    return String(av ?? '').localeCompare(String(bv ?? '')) * direction
  })
}

/**
 * Build the ad-hoc QueryConfig for one pattern's aggregated stats, scoped to
 * `normalized_query_hash` + a relative time window. Expects query params
 * `{ normalized_query_hash: string, range_hours: number }`.
 */
export function buildPatternDetailConfig(): QueryConfig {
  return {
    name: 'insights-query-pattern-detail',
    tableCheck: 'system.query_log',
    columns: [],
    sql: buildQueryPatternsSql(
      `WHERE normalized_query_hash = toUInt64OrZero({normalized_query_hash:String})
        AND event_time > now() - toIntervalHour({range_hours:UInt32})`
    ),
  }
}

/**
 * Build the ad-hoc QueryConfig for the individual `system.query_log`
 * executions behind one pattern, reverse-chronological. Expects query params
 * `{ normalized_query_hash: string, range_hours: number, executions_limit: number }`.
 */
export function buildPatternExecutionsConfig(): QueryConfig {
  return {
    name: 'insights-query-pattern-executions',
    tableCheck: 'system.query_log',
    columns: [],
    sql: `
      SELECT
          event_time,
          query_id,
          user,
          query_kind,
          current_database AS database,
          query_duration_ms,
          memory_usage,
          formatReadableSize(memory_usage) AS readable_memory_usage,
          read_rows,
          read_bytes,
          formatReadableSize(read_bytes) AS readable_read_bytes,
          result_rows,
          written_bytes,
          exception_code,
          exception,
          query
      FROM system.query_log
      WHERE type IN ${EXECUTION_TYPES}
        AND normalized_query_hash = toUInt64OrZero({normalized_query_hash:String})
        AND event_time > now() - toIntervalHour({range_hours:UInt32})
      ORDER BY event_time DESC
      LIMIT {executions_limit:UInt32}
    `,
  }
}
