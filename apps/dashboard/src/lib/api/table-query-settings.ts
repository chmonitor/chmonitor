import type { ClickHouseSettings } from '@clickhouse/client'

import type { QueryConfig } from '@/types/query-config'

/**
 * Default server-side row cap for table queries (#2490). Many table configs
 * run `SELECT *` with no LIMIT (detached-parts, replicas,
 * asynchronous-metrics, metrics, settings, users, roles, backups,
 * view-refreshes, …); on a large/damaged cluster this can ship tens of
 * thousands of rows to the browser, which then paginates client-side.
 * `CHM_TABLE_MAX_RESULT_ROWS` overrides the default; `0` disables the cap.
 */
export const TABLE_RESULT_ROW_LIMIT = 10_000
export const TABLE_RESULT_OVERFLOW_MODE = 'break'

export type TableResultRowCap<T> = {
  data: T
  sourceRows?: number
  returnedRows?: number
  truncated: boolean
}

export type TableClickHouseSettings = ClickHouseSettings & {
  /** IANA timezone for ClickHouse session time conversion */
  session_timezone?: string
}

/**
 * Resolve the row cap for table queries from `CHM_TABLE_MAX_RESULT_ROWS`
 * (default `TABLE_RESULT_ROW_LIMIT`). Returns `0` when explicitly disabled
 * (`0`) or the env value is not a positive finite number.
 */
export function resolveTableResultRowLimit(
  env: string | undefined = process.env.CHM_TABLE_MAX_RESULT_ROWS
): number {
  if (env === undefined || env === '') return TABLE_RESULT_ROW_LIMIT
  const parsed = Number(env)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

function resolveResultRowLimit(
  configuredLimit: ClickHouseSettings['max_result_rows'] | undefined,
  cap: number
): number {
  const numericLimit = Number(configuredLimit)

  if (Number.isFinite(numericLimit) && numericLimit > 0) {
    return Math.min(numericLimit, cap)
  }

  return cap
}

/**
 * Build the `clickhouse_settings` for a table query, applying the row cap
 * (`max_result_rows` + `result_overflow_mode: 'break'`) so ClickHouse
 * truncates server-side instead of shipping an unbounded result set (#2490).
 * A config's own `max_result_rows` is respected as long as it doesn't exceed
 * the resolved cap. Passing `cap: 0` (`CHM_TABLE_MAX_RESULT_ROWS=0`) disables
 * the cap entirely — no `max_result_rows`/`result_overflow_mode` are set.
 */
export function getTableClickHouseSettings(
  config: QueryConfig | undefined,
  timezone: string | undefined,
  cap: number = resolveTableResultRowLimit()
): TableClickHouseSettings {
  const configSettings = config?.clickhouseSettings ?? {}

  if (cap <= 0) {
    return {
      ...configSettings,
      ...(timezone ? { session_timezone: timezone } : {}),
    }
  }

  const maxResultRows = resolveResultRowLimit(
    configSettings.max_result_rows,
    cap
  )

  return {
    ...configSettings,
    ...(timezone ? { session_timezone: timezone } : {}),
    max_result_rows: String(maxResultRows),
    result_overflow_mode: TABLE_RESULT_OVERFLOW_MODE,
  }
}

export function capTableResultRows<T>(
  data: T,
  rowLimit: number
): TableResultRowCap<T> {
  if (!Array.isArray(data)) {
    return { data, truncated: false }
  }

  const sourceRows = data.length

  if (sourceRows <= rowLimit) {
    return {
      data,
      sourceRows,
      returnedRows: sourceRows,
      truncated: false,
    }
  }

  return {
    data: data.slice(0, rowLimit) as T,
    sourceRows,
    returnedRows: rowLimit,
    truncated: true,
  }
}

/**
 * Detect whether a table query's result was truncated by the row cap
 * (#2490), given the number of rows actually returned, the cap that was
 * applied (`0` = disabled), and ClickHouse's `rows_before_limit_at_least`
 * statistic (present when `result_overflow_mode: 'break'` — or a plain
 * LIMIT — cut the result short). Pure function so it's cheap to unit test
 * independent of any live ClickHouse response.
 */
export function detectTableTruncation({
  dataLength,
  cap,
  rowsBeforeLimit,
}: {
  dataLength: number
  cap: number
  rowsBeforeLimit: number | undefined
}): { truncated: boolean; rowsBeforeCap?: number } {
  if (cap <= 0) return { truncated: false }
  if (rowsBeforeLimit === undefined || rowsBeforeLimit <= dataLength) {
    return { truncated: false }
  }
  return { truncated: true, rowsBeforeCap: rowsBeforeLimit }
}
