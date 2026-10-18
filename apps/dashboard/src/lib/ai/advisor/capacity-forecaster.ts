/**
 * Capacity forecast & TTL advisor: disk-full dates from `system.part_log`
 * NewPart write volume, plus TTL suggestions. Recommend-only: `suggestTtl`
 * returns a suggestion string and risk note, never executes DDL, and never
 * suggests a TTL below the caller's retention floor.
 *
 * `system.part_log` is optional (opt-in in ClickHouse config); entry points
 * return `PartLogUnavailable` instead of fabricating a forecast when missing.
 */

import { checkTableExists } from '@chm/clickhouse-client/table-existence-cache'
import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'
import { formatBytes } from '@/lib/utils'

const NEW_PART_EVENT_TYPE = 1
const FORECAST_WINDOW_DAYS = 30
const DEFAULT_HORIZON_DAYS = 90
const DISK_UTILIZATION_TARGET = 0.8
const DEFAULT_RETENTION_FLOOR_DAYS = 30
const MIN_SAMPLE_DAYS_FOR_CONFIDENCE = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000
/**
 * Projections beyond this (100 years) mean "effectively never": meaningless for
 * planning, and a tiny positive growth rate against large free space can make
 * `Date.now() + daysToFull * MS_PER_DAY` overflow JS's date range, throwing a
 * `RangeError` from `toISOString()`.
 */
const MAX_MEANINGFUL_FORECAST_DAYS = 36_500

const PART_LOG_UNAVAILABLE_MESSAGE =
  'system.part_log is not enabled on this ClickHouse server (or is inaccessible to this user). Capacity forecasting and TTL suggestions need part_log to estimate the write-growth rate — enable it in the ClickHouse server config (<part_log> section), let it accumulate history, then retry. Refusing to fabricate a forecast without it.'

export type GrowthConfidence = 'low' | 'medium' | 'high'

export interface PartLogUnavailable {
  available: false
  reason: 'part_log_disabled'
  message: string
}

export interface HotTable {
  database: string
  table: string
  fullTable: string
  bytesWritten: number
  readableBytesWritten: string
}

export interface HotTablesAvailable {
  available: true
  windowDays: number
  tables: HotTable[]
}

export type HotTablesResult = PartLogUnavailable | HotTablesAvailable

export interface DiskForecast {
  available: true
  hostId: number
  horizonDays: number
  sampleDays: number
  dailyGrowthBytes: number
  readableDailyGrowth: string
  daysToFull: number | null
  fullDate: string | null
  willExceedHorizon: boolean
  confidence: GrowthConfidence
  freeBytes: number
  totalBytes: number
  topContributors: HotTable[]
  caveat: string
  explanation: string
}

export type ForecastResult = PartLogUnavailable | DiskForecast

export interface TtlSuggestion {
  available: true
  database: string
  table: string
  currentBytes: number
  dailyGrowthBytes: number
  growthConfidence: GrowthConfidence
  retentionRequirementDays: number
  retentionAssumedDefault: boolean
  suggestedTtlDays: number
  meetsUtilizationTarget: boolean
  dateColumn: string | null
  sql: string
  riskNote: string
  explanation: string
}

export type TtlResult = PartLogUnavailable | TtlSuggestion

/**
 * Dense daily byte series over `windowDays`, zero-filled; index 0 is oldest.
 * ClickHouse `toDate(event_time)` buckets in server timezone while this keys
 * in UTC, so on a non-UTC server an edge bucket can be off by one: a minor
 * undercount, not a correctness hazard.
 */
export function buildDailySeries(
  rows: Array<{ day: string; bytes: number }>,
  windowDays: number,
  referenceDate: Date = new Date()
): number[] {
  const byDay = new Map(rows.map((r) => [r.day, r.bytes]))
  const series: number[] = []
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(referenceDate)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    series.push(byDay.get(key) ?? 0)
  }
  return series
}

/**
 * Ordinary least squares over the cumulative sum of `dailyBytes`; fitting the
 * cumulative series keeps `slope` stable when ingestion is bursty.
 */
export function fitLinearGrowth(dailyBytes: number[]): {
  slope: number
  intercept: number
} {
  const n = dailyBytes.length
  if (n === 0) return { slope: 0, intercept: 0 }

  const cumulative: number[] = []
  let running = 0
  for (const v of dailyBytes) {
    running += v
    cumulative.push(running)
  }

  const xMean = (n - 1) / 2
  const yMean = cumulative.reduce((a, b) => a + b, 0) / n

  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const dx = i - xMean
    num += dx * (cumulative[i] - yMean)
    den += dx * dx
  }

  const slope = den === 0 ? 0 : num / den
  const intercept = yMean - slope * xMean
  return { slope, intercept }
}

/**
 * Confidence from the *daily* series' dispersion (stddev / mean), not the
 * cumulative fit's R²: a cumulative sum of non-negative values is near-linear
 * even when daily ingestion is wildly bursty, which would over-report
 * confidence exactly when one batch could blow the estimate. Capped at 'low'
 * with too little history.
 */
export function growthConfidence(dailyBytes: number[]): GrowthConfidence {
  const n = dailyBytes.length
  if (n < MIN_SAMPLE_DAYS_FOR_CONFIDENCE) return 'low'

  const mean = dailyBytes.reduce((a, b) => a + b, 0) / n
  if (mean <= 0) return 'low'

  const variance = dailyBytes.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n
  const cv = Math.sqrt(variance) / mean

  if (cv <= 0.5) return 'high'
  if (cv <= 1.0) return 'medium'
  return 'low'
}

export interface TtlSuggestionInput {
  currentBytes: number
  dailyGrowthBytes: number
  freeBytes: number
  totalBytes: number
  retentionDays: number
}

export interface TtlSuggestionMath {
  nSafeDays: number | null
  suggestedTtlDays: number
  meetsUtilizationTarget: boolean
  riskNote: string
}

/**
 * Largest TTL (days) keeping projected utilization at/under
 * {@link DISK_UTILIZATION_TARGET}. Steady state: with a TTL of N days a table
 * plateaus at `dailyGrowthBytes * N`, so solve `otherUsedBytes +
 * dailyGrowthBytes * N <= target * totalBytes`. If N falls below the retention
 * floor, the floor wins and the risk note says so instead of silently
 * suggesting an unsafe TTL. Pure, so the "never below the floor" invariant can
 * be fuzzed.
 */
export function computeTtlSuggestion(
  input: TtlSuggestionInput
): TtlSuggestionMath {
  const {
    currentBytes,
    dailyGrowthBytes,
    freeBytes,
    totalBytes,
    retentionDays,
  } = input

  const otherUsedBytes = Math.max(0, totalBytes - freeBytes - currentBytes)
  const targetMaxTotalBytes = DISK_UTILIZATION_TARGET * totalBytes
  const maxTableBytesAtTarget = Math.max(
    0,
    targetMaxTotalBytes - otherUsedBytes
  )

  const rawNSafeDays =
    dailyGrowthBytes > 0
      ? Math.floor(maxTableBytesAtTarget / dailyGrowthBytes)
      : null
  // Growth so slow it takes >100 years to matter is "not growing"; avoids an absurd `INTERVAL <huge> DAY`.
  const nSafeDays =
    rawNSafeDays !== null && rawNSafeDays <= MAX_MEANINGFUL_FORECAST_DAYS
      ? rawNSafeDays
      : null

  const meetsUtilizationTarget =
    nSafeDays === null || nSafeDays >= retentionDays
  const suggestedTtlDays =
    nSafeDays !== null && nSafeDays >= retentionDays ? nSafeDays : retentionDays

  const targetPct = Math.round(DISK_UTILIZATION_TARGET * 100)
  const riskNote = meetsUtilizationTarget
    ? `Applying this TTL deletes data older than ${suggestedTtlDays} days. Projected disk utilization from this table's growth stays at or under ${targetPct}%.`
    : `Even at the ${retentionDays}-day retention floor, this table's growth is projected to push disk utilization above ${targetPct}% in ~${nSafeDays} day(s). The retention floor was kept — this TTL does NOT resolve the capacity risk; consider adding disk capacity, archiving cold partitions, or moving this table to a cheaper storage tier instead of shortening retention further.`

  return { nSafeDays, suggestedTtlDays, meetsUtilizationTarget, riskNote }
}

async function isPartLogAvailable(hostId: number): Promise<boolean> {
  // 'unknown' means the probe itself failed, not a confirmed answer: treat as unavailable, never fabricate a forecast.
  return (await checkTableExists(hostId, 'system', 'part_log')) === true
}

async function queryDailyNewPartBytes(
  hostId: number,
  windowDays: number,
  filter?: { database: string; table: string }
): Promise<Array<{ day: string; bytes: number }>> {
  const whereTable = filter
    ? ' AND database = {database:String} AND table = {table:String}'
    : ''
  const rows = (await readOnlyQuery({
    query: `SELECT toString(toDate(event_time)) AS day, sum(size_in_bytes) AS bytes FROM system.part_log WHERE toInt8(event_type) = {eventType:UInt8} AND event_time >= now() - INTERVAL {windowDays:UInt32} DAY${whereTable} GROUP BY day ORDER BY day`,
    query_params: {
      eventType: NEW_PART_EVENT_TYPE,
      windowDays,
      ...(filter ?? {}),
    },
    hostId,
  })) as Array<{ day: string; bytes: string | number }>

  return rows.map((r) => ({ day: r.day, bytes: Number(r.bytes) }))
}

async function queryDiskTotals(
  hostId: number
): Promise<{ freeBytes: number; totalBytes: number }> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT sum(free_space) AS free_bytes, sum(total_space) AS total_bytes FROM system.disks',
    hostId,
  })) as Array<{ free_bytes: string | number; total_bytes: string | number }>

  return {
    freeBytes: Number(rows[0]?.free_bytes ?? 0),
    totalBytes: Number(rows[0]?.total_bytes ?? 0),
  }
}

async function queryTableCurrentBytes(
  hostId: number,
  database: string,
  table: string
): Promise<number> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT sum(bytes_on_disk) AS bytes FROM system.parts WHERE active = 1 AND database = {database:String} AND table = {table:String}',
    query_params: { database, table },
    hostId,
  })) as Array<{ bytes: string | number }>

  return Number(rows[0]?.bytes ?? 0)
}

async function detectTtlDateColumn(
  hostId: number,
  database: string,
  table: string
): Promise<string | null> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT name, type, is_in_partition_key, is_in_sorting_key FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
    query_params: { database, table },
    hostId,
  })) as Array<{
    name: string
    type: string
    is_in_partition_key: number | string
    is_in_sorting_key: number | string
  }>

  const isDateType = (type: string) => /^(Date|DateTime)/.test(type)
  const truthy = (v: number | string) => Number(v) === 1

  const partitionCol = rows.find(
    (r) => truthy(r.is_in_partition_key) && isDateType(r.type)
  )
  if (partitionCol) return partitionCol.name

  const sortingCol = rows.find(
    (r) => truthy(r.is_in_sorting_key) && isDateType(r.type)
  )
  if (sortingCol) return sortingCol.name

  const anyDateCol = rows.find((r) => isDateType(r.type))
  return anyDateCol ? anyDateCol.name : null
}

async function queryEngineFull(
  hostId: number,
  database: string,
  table: string
): Promise<string | null> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT engine_full FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
    query_params: { database, table },
    hostId,
  })) as Array<{ engine_full: string }>

  const engineFull = rows[0]?.engine_full?.trim()
  return engineFull || null
}

export function detectExistingTtlPolicy(engineFull: string | null): {
  hasTtl: boolean
  expression: string | null
} {
  if (!engineFull) return { hasTtl: false, expression: null }
  const ttlIndex = engineFull.search(/\bTTL\b/i)
  if (ttlIndex < 0) return { hasTtl: false, expression: null }

  const tail = engineFull.slice(ttlIndex)
  const match = tail.match(/\bTTL\b\s+([\s\S]+?)(?:,\s*SETTINGS\b|$)/i)
  const expression = (match?.[1] ?? tail.replace(/^\s*TTL\s+/i, '')).trim()
  return { hasTtl: true, expression: expression || null }
}

export async function identifyHotTables(
  hostId: number,
  n = 5
): Promise<HotTablesResult> {
  if (!(await isPartLogAvailable(hostId))) {
    return {
      available: false,
      reason: 'part_log_disabled',
      message: PART_LOG_UNAVAILABLE_MESSAGE,
    }
  }

  const rows = (await readOnlyQuery({
    query:
      'SELECT database, table, sum(size_in_bytes) AS bytes_written FROM system.part_log WHERE toInt8(event_type) = {eventType:UInt8} AND event_time >= now() - INTERVAL {windowDays:UInt32} DAY GROUP BY database, table ORDER BY bytes_written DESC LIMIT {limit:UInt32}',
    query_params: {
      eventType: NEW_PART_EVENT_TYPE,
      windowDays: FORECAST_WINDOW_DAYS,
      limit: n,
    },
    hostId,
  })) as Array<{
    database: string
    table: string
    bytes_written: string | number
  }>

  return {
    available: true,
    windowDays: FORECAST_WINDOW_DAYS,
    tables: rows.map((r) => {
      const bytesWritten = Number(r.bytes_written)
      return {
        database: r.database,
        table: r.table,
        fullTable: `${r.database}.${r.table}`,
        bytesWritten,
        readableBytesWritten: formatBytes(bytesWritten),
      }
    }),
  }
}

/** Returns `available: false` (never a fabricated number) when `system.part_log` isn't enabled. */
export async function forecastDiskFull(
  hostId: number,
  horizonDays = DEFAULT_HORIZON_DAYS
): Promise<ForecastResult> {
  if (!(await isPartLogAvailable(hostId))) {
    return {
      available: false,
      reason: 'part_log_disabled',
      message: PART_LOG_UNAVAILABLE_MESSAGE,
    }
  }

  const [dailyRows, diskTotals] = await Promise.all([
    queryDailyNewPartBytes(hostId, FORECAST_WINDOW_DAYS),
    queryDiskTotals(hostId),
  ])

  const dailySeries = buildDailySeries(dailyRows, FORECAST_WINDOW_DAYS)
  const { slope } = fitLinearGrowth(dailySeries)
  const dailyGrowthBytes = Math.max(0, slope)
  const confidence = growthConfidence(dailySeries)
  const { freeBytes, totalBytes } = diskTotals

  const rawDaysToFull =
    dailyGrowthBytes > 0 ? Math.floor(freeBytes / dailyGrowthBytes) : null
  // >100 years to fill is "never"; also avoids a Date overflow RangeError
  // from toISOString() below (see MAX_PROJECTED_DAYS).
  const daysToFull =
    rawDaysToFull !== null && rawDaysToFull <= MAX_MEANINGFUL_FORECAST_DAYS
      ? rawDaysToFull
      : null
  const fullDate =
    daysToFull !== null
      ? new Date(Date.now() + daysToFull * MS_PER_DAY)
          .toISOString()
          .slice(0, 10)
      : null
  const willExceedHorizon = daysToFull !== null && daysToFull <= horizonDays

  // Best-effort enrichment: a failure must not sink the whole forecast.
  let topContributors: HotTable[] = []
  try {
    const hot = await identifyHotTables(hostId, 5)
    if (hot.available) topContributors = hot.tables
  } catch {
    // enrichment only
  }

  const explanation =
    daysToFull !== null
      ? `Disk writes are growing ~${formatBytes(dailyGrowthBytes)}/day (${confidence} confidence, from ${dailySeries.length} days of system.part_log history). At this rate, the ${formatBytes(freeBytes)} currently free will be exhausted in ~${daysToFull} day(s), around ${fullDate}.${willExceedHorizon ? ` This is within your ${horizonDays}-day horizon.` : ''}`
      : dailyGrowthBytes > 0
        ? `Disk writes are growing negligibly slowly (~${formatBytes(dailyGrowthBytes)}/day) relative to the ${formatBytes(freeBytes)} currently free — projected to take over ${MAX_MEANINGFUL_FORECAST_DAYS} days to fill, effectively no near-term risk.`
        : `No sustained growth detected in new-part write volume over the last ${dailySeries.length} days — disk usage is not currently trending toward full from ingestion.`

  return {
    available: true,
    hostId,
    horizonDays,
    sampleDays: dailySeries.length,
    dailyGrowthBytes,
    readableDailyGrowth: formatBytes(dailyGrowthBytes),
    daysToFull,
    fullDate,
    willExceedHorizon,
    confidence,
    freeBytes,
    totalBytes,
    topContributors,
    caveat:
      'Estimate is based on new-part write volume only (system.part_log NewPart events) — it does not subtract space that TTL/expiry or manual deletes will reclaim, and free space is summed across all system.disks entries (optimistic if storage policies restrict this data to one disk).',
    explanation,
  }
}

/** Recommend-only: returns a suggestion string, never executes it. */
export async function suggestTtl(params: {
  hostId: number
  database: string
  table: string
  retentionDays: number
  retentionAssumedDefault?: boolean
}): Promise<TtlResult> {
  const {
    hostId,
    database,
    table,
    retentionDays: rawRetentionDays,
    retentionAssumedDefault = false,
  } = params

  const retentionClamped = rawRetentionDays <= 0
  const retentionDays = Math.max(1, rawRetentionDays)

  if (!(await isPartLogAvailable(hostId))) {
    return {
      available: false,
      reason: 'part_log_disabled',
      message: PART_LOG_UNAVAILABLE_MESSAGE,
    }
  }

  const [currentBytes, dailyRows, diskTotals, dateColumn, engineFull] =
    await Promise.all([
      queryTableCurrentBytes(hostId, database, table),
      queryDailyNewPartBytes(hostId, FORECAST_WINDOW_DAYS, { database, table }),
      queryDiskTotals(hostId),
      detectTtlDateColumn(hostId, database, table),
      queryEngineFull(hostId, database, table),
    ])

  const dailySeries = buildDailySeries(dailyRows, FORECAST_WINDOW_DAYS)
  const { slope } = fitLinearGrowth(dailySeries)
  const dailyGrowthBytes = Math.max(0, slope)
  const confidence = growthConfidence(dailySeries)

  const { nSafeDays, suggestedTtlDays, meetsUtilizationTarget, riskNote } =
    computeTtlSuggestion({
      currentBytes,
      dailyGrowthBytes,
      freeBytes: diskTotals.freeBytes,
      totalBytes: diskTotals.totalBytes,
      retentionDays,
    })

  const fullTable = `\`${database}\`.\`${table}\``
  const baseSql = dateColumn
    ? `ALTER TABLE ${fullTable} MODIFY TTL ${dateColumn} + INTERVAL ${suggestedTtlDays} DAY`
    : `-- No Date/DateTime column found in ${database}.${table}'s partition or sorting key — replace <date_column> with the correct column before running:\nALTER TABLE ${fullTable} MODIFY TTL <date_column> + INTERVAL ${suggestedTtlDays} DAY`

  const { hasTtl, expression: existingTtl } =
    detectExistingTtlPolicy(engineFull)
  let sql = baseSql
  let ttlReplaceWarning = ''
  if (hasTtl && existingTtl && dateColumn) {
    ttlReplaceWarning =
      `Table already has a TTL — MODIFY TTL REPLACES the whole policy. Merge instead: ` +
      `ALTER TABLE ${fullTable} MODIFY TTL ${existingTtl}, ${dateColumn} + INTERVAL ${suggestedTtlDays} DAY`
    sql =
      `-- WARNING: Table already has a TTL policy. MODIFY TTL REPLACES the entire expression.\n` +
      `-- Existing TTL: ${existingTtl}\n` +
      `-- Merge form (preserves existing policy):\n` +
      `ALTER TABLE ${fullTable} MODIFY TTL ${existingTtl}, ${dateColumn} + INTERVAL ${suggestedTtlDays} DAY\n\n` +
      `-- Original suggestion (REPLACES existing TTL — prefer merge form above):\n` +
      baseSql
  }

  const retentionNote = retentionAssumedDefault
    ? `Assuming a ${retentionDays}-day minimum retention (no retentionRequirementDays was given — pass one to override this default).`
    : `Using your stated ${retentionDays}-day minimum retention.`
  const clampNote = retentionClamped
    ? `Retention was clamped from ${rawRetentionDays} to ${retentionDays} day(s) — INTERVAL 0 DAY is not emitted.`
    : ''

  const explanation = `${retentionNote}${clampNote ? ` ${clampNote}` : ''} ${database}.${table} is currently ${formatBytes(currentBytes)} and growing ~${formatBytes(dailyGrowthBytes)}/day (${confidence} confidence, ${dailySeries.length} days of history). ${nSafeDays !== null ? `The largest TTL that keeps projected disk utilization at/under 80% is ~${nSafeDays} day(s). ` : ''}Suggested TTL: ${suggestedTtlDays} day(s) — this is a suggestion only, never applied automatically.${ttlReplaceWarning ? ` ${ttlReplaceWarning}` : ''}`

  const combinedRiskNote = ttlReplaceWarning
    ? `${riskNote} ${ttlReplaceWarning}`
    : riskNote

  return {
    available: true,
    database,
    table,
    currentBytes,
    dailyGrowthBytes,
    growthConfidence: confidence,
    retentionRequirementDays: retentionDays,
    retentionAssumedDefault,
    suggestedTtlDays,
    meetsUtilizationTarget,
    dateColumn,
    sql,
    riskNote: combinedRiskNote,
    explanation,
  }
}

export {
  DEFAULT_RETENTION_FLOOR_DAYS,
  DEFAULT_HORIZON_DAYS,
  FORECAST_WINDOW_DAYS,
}
