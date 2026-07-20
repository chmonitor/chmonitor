/**
 * Cluster-metric collectors for the scheduled health report.
 *
 * Each collector runs read-only queries against a single host and returns the
 * data for ONE optional report section (query activity / ingestion / storage),
 * or `undefined` when anything fails — the report degrades by omitting the
 * section rather than aborting (same fail-open contract as `collectors.ts`).
 *
 * Measurement model mirrors the traffic/ingestion page
 * (docs/knowledge/traffic-insights.md): ingestion is measured from
 * `system.query_log` `written_rows`/`written_bytes` on finished INSERTs
 * (uncompressed, always available — no `part_log` opt-in dependency), and
 * storage from active `system.parts`. All columns used here exist since the
 * project's 23.8 baseline (see docs/clickhouse-schemas/tables/query_log.md),
 * so no versioned SQL is needed.
 */

import type {
  ReportSeriesPoint,
  WeeklyReportIngestion,
  WeeklyReportQueryActivity,
  WeeklyReportStorage,
  WeeklyReportTopTable,
} from './types'

import { debug } from '@chm/logger'
import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'

/** One point per day; a monthly (30-day) window plus today is at most 31. */
const MAX_SERIES_POINTS = 31

/** Coerce a ClickHouse JSON value (UInt64 arrives as string) to a finite number. */
function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function series(
  rows: ReadonlyArray<Record<string, unknown>>,
  valueKey: string
): ReportSeriesPoint[] {
  return rows
    .map((row) => ({ date: String(row.date ?? ''), value: num(row[valueKey]) }))
    .slice(-MAX_SERIES_POINTS)
}

function logSkip(section: string, hostId: number, err: unknown): undefined {
  debug(
    `[report-metrics] ${section} unavailable for host ${hostId}: ${err instanceof Error ? err.message : String(err)}`
  )
  return undefined
}

/**
 * Query activity over the window: total/failed counts, p50/p95 duration, and
 * per-day query + failure series from `system.query_log`.
 */
export async function collectQueryActivity(
  hostId: number,
  windowDays: number
): Promise<WeeklyReportQueryActivity | undefined> {
  try {
    const totals = (await readOnlyQuery({
      hostId,
      query: `
        SELECT
          countIf(type = 'QueryFinish') AS queries,
          countIf(type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')) AS failed,
          round(quantileIf(0.5)(query_duration_ms, type = 'QueryFinish')) AS p50_ms,
          round(quantileIf(0.95)(query_duration_ms, type = 'QueryFinish')) AS p95_ms
        FROM system.query_log
        WHERE event_time >= now() - INTERVAL {days:UInt32} DAY
          AND type != 'QueryStart'`,
      query_params: { days: windowDays },
    })) as Array<Record<string, unknown>>

    const daily = (await readOnlyQuery({
      hostId,
      query: `
        SELECT
          toDate(event_time) AS date,
          countIf(type = 'QueryFinish') AS queries,
          countIf(type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')) AS failed
        FROM system.query_log
        WHERE event_time >= now() - INTERVAL {days:UInt32} DAY
          AND type != 'QueryStart'
        GROUP BY date
        ORDER BY date`,
      query_params: { days: windowDays },
    })) as Array<Record<string, unknown>>

    if (!Array.isArray(totals) || totals.length === 0 || !Array.isArray(daily))
      return undefined

    const t = totals[0]
    return {
      totalQueries: num(t.queries),
      failedQueries: num(t.failed),
      p50Ms: num(t.p50_ms),
      p95Ms: num(t.p95_ms),
      dailyQueries: series(daily, 'queries'),
      dailyFailed: series(daily, 'failed'),
    }
  } catch (err) {
    return logSkip('query activity', hostId, err)
  }
}

/**
 * Ingestion over the window: per-day rows/bytes written by finished INSERTs
 * (`system.query_log`, uncompressed measurement — matches the traffic page).
 */
export async function collectIngestion(
  hostId: number,
  windowDays: number
): Promise<WeeklyReportIngestion | undefined> {
  try {
    const daily = (await readOnlyQuery({
      hostId,
      query: `
        SELECT
          toDate(event_time) AS date,
          sum(written_rows) AS rows,
          sum(written_bytes) AS bytes
        FROM system.query_log
        WHERE type = 'QueryFinish'
          AND query_kind = 'Insert'
          AND event_time >= now() - INTERVAL {days:UInt32} DAY
        GROUP BY date
        ORDER BY date`,
      query_params: { days: windowDays },
    })) as Array<Record<string, unknown>>

    if (!Array.isArray(daily)) return undefined

    const dailyRows = series(daily, 'rows')
    const dailyBytes = series(daily, 'bytes')
    return {
      totalRows: dailyRows.reduce((acc, p) => acc + p.value, 0),
      totalBytes: dailyBytes.reduce((acc, p) => acc + p.value, 0),
      dailyRows,
      dailyBytes,
    }
  } catch (err) {
    return logSkip('ingestion', hostId, err)
  }
}

/**
 * Storage snapshot: total active bytes/rows plus the top 5 user tables by
 * on-disk size, each with the bytes (re)written within the window
 * (`modification_time` — an approximation, merges rewrite parts).
 */
export async function collectStorage(
  hostId: number,
  windowDays: number
): Promise<WeeklyReportStorage | undefined> {
  try {
    const totals = (await readOnlyQuery({
      hostId,
      query: `
        SELECT sum(bytes_on_disk) AS bytes, sum(rows) AS rows
        FROM system.parts
        WHERE active`,
    })) as Array<Record<string, unknown>>

    const top = (await readOnlyQuery({
      hostId,
      query: `
        SELECT
          concat(database, '.', table) AS table,
          sum(bytes_on_disk) AS bytes,
          sum(rows) AS rows,
          sumIf(bytes_on_disk, modification_time >= now() - INTERVAL {days:UInt32} DAY) AS new_bytes
        FROM system.parts
        WHERE active
          AND database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        GROUP BY database, table
        ORDER BY bytes DESC
        LIMIT 5`,
      query_params: { days: windowDays },
    })) as Array<Record<string, unknown>>

    if (!Array.isArray(totals) || totals.length === 0 || !Array.isArray(top))
      return undefined

    const topTables: WeeklyReportTopTable[] = top.map((row) => ({
      table: String(row.table ?? ''),
      bytes: num(row.bytes),
      rows: num(row.rows),
      newBytes: num(row.new_bytes),
    }))

    return {
      totalBytes: num(totals[0].bytes),
      totalRows: num(totals[0].rows),
      topTables,
    }
  } catch (err) {
    return logSkip('storage', hostId, err)
  }
}
