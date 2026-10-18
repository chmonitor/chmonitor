import type { ClickHouseSettings } from '@clickhouse/client'

import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'
import type { QueryConfig } from '@/types/query-config'

import { meetsMinVersion } from '@chm/clickhouse-client/clickhouse-version'

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

const ANALYZER_SETTINGS = ['allow_experimental_analyzer', 'enable_analyzer']
const FALSY_SETTING_VALUES = new Set(['0', 'false'])

/**
 * Drop config settings the server's version rejects. ClickHouse 26.9 made the
 * analyzer mandatory and fails any query that turns it off
 * (SETTING_CONSTRAINT_VIOLATION), so `allow_experimental_analyzer: 0` /
 * `enable_analyzer: 0` is removed there and kept on older versions, where the
 * config still gets the old analyzer it asked for. Unknown version: unchanged.
 */
export function dropUnsupportedSettings<T extends Record<string, unknown>>(
  settings: T,
  version: ClickHouseVersion | null | undefined
): T {
  if (!version || !meetsMinVersion(version, 26, 9)) return settings
  const out: Record<string, unknown> = { ...settings }
  for (const key of ANALYZER_SETTINGS) {
    if (key in out && FALSY_SETTING_VALUES.has(String(out[key]).toLowerCase()))
      delete out[key]
  }
  return out as T
}

/**
 * A config's own `max_result_rows` is respected as long as it doesn't exceed the cap; `cap: 0`
 * disables the cap. Settings `version` rejects are dropped first (see `dropUnsupportedSettings`).
 */
export function getTableClickHouseSettings(
  config: QueryConfig | undefined,
  timezone: string | undefined,
  cap: number = resolveTableResultRowLimit(),
  version: ClickHouseVersion | null = null
): TableClickHouseSettings {
  const configSettings = dropUnsupportedSettings(
    config?.clickhouseSettings ?? {},
    version
  )

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
