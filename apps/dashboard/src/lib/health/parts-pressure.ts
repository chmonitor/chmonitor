/**
 * Predictive "too many parts" pressure — shared core.
 *
 * A MergeTree table rejects inserts once a single partition reaches
 * `parts_to_throw_insert` active parts, and throttles them at
 * `parts_to_delay_insert`. Those failures normally arrive without warning. This
 * module projects *when* a partition will hit the throw threshold from its
 * recent net part-growth rate (part creation vs merge consumption, read from
 * `system.part_log`) so the health engine can warn ahead of time.
 *
 * Everything here is pure (SQL string builders + projection/classification math)
 * so it is unit-tested directly. `system-charts.ts` (health card + evidence),
 * `builtin-rules.ts` (alert channels) and the insight collector all consume it.
 *
 * Two surfaces, one metric family:
 * - **Fill percent** (`current parts / parts_to_throw_insert`) is the headline
 *   scalar for the /health card + alert rule — higher-is-worse, so it fits the
 *   shared warning/critical threshold storage every other check uses.
 * - **Time-to-threshold projection** (needs `system.part_log`) drives the card's
 *   evidence drill-down and the AI-insight finding, which warns inside a
 *   configurable window (default 6h) and escalates to critical inside 1h or when
 *   the partition is already delaying. Falls back to fill-percent-only when
 *   part_log is disabled.
 */

/** Warn when a partition is projected to breach parts_to_throw_insert within this many hours. */
export const PARTS_PRESSURE_WARN_WINDOW_HOURS = 6
/** Escalate to critical when the projected breach is within this many hours. */
export const PARTS_PRESSURE_CRITICAL_WINDOW_HOURS = 1
/** Lookback window (hours) over system.part_log used to measure the net part-growth rate. */
export const PARTS_PRESSURE_RATE_WINDOW_HOURS = 6
/** Ignore partitions smaller than this — tiny partitions are noise, never pressure. */
export const PARTS_PRESSURE_MIN_PARTS = 20

/**
 * Fallback thresholds when `system.merge_tree_settings` cannot be read. These
 * match modern ClickHouse defaults (parts_to_throw_insert=3000,
 * parts_to_delay_insert=1000); the queries always prefer the live server value
 * and any per-table override extracted from `create_table_query`.
 */
export const DEFAULT_PARTS_TO_THROW_INSERT = 3000
export const DEFAULT_PARTS_TO_DELAY_INSERT = 1000

/** Fill-percent thresholds for the /health card + alert rule (higher-is-worse). */
export const PARTS_PRESSURE_PERCENT_WARNING = 80
export const PARTS_PRESSURE_PERCENT_CRITICAL = 95

/** Databases whose parts are internal and never surfaced. */
const EXCLUDED_DATABASES =
  "'system', 'INFORMATION_SCHEMA', 'information_schema'"

/** Clamp an interpolated interval/limit to a safe positive integer for SQL. */
function safeInt(value: number, fallback: number): number {
  const n = Math.trunc(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Per-partition effective throw/delay limits: the per-table override parsed from
 * `create_table_query` when present, else the live server default from
 * `system.merge_tree_settings`, else the compiled-in fallback. Emitted as a CTE
 * body shared by the projection and scalar queries.
 */
function effectiveLimitsCte(): string {
  return `parts_now AS (
    SELECT database, table, partition, count() AS parts
    FROM system.parts
    WHERE active AND database NOT IN (${EXCLUDED_DATABASES})
    GROUP BY database, table, partition
  ),
  table_overrides AS (
    SELECT
      database,
      name AS table,
      toInt64OrZero(extract(create_table_query, 'parts_to_throw_insert *= *([0-9]+)')) AS throw_override,
      toInt64OrZero(extract(create_table_query, 'parts_to_delay_insert *= *([0-9]+)')) AS delay_override
    FROM system.tables
    WHERE database NOT IN (${EXCLUDED_DATABASES})
  ),
  server_defaults AS (
    SELECT
      coalesce((SELECT toInt64OrNull(value) FROM system.merge_tree_settings WHERE name = 'parts_to_throw_insert'), ${DEFAULT_PARTS_TO_THROW_INSERT}) AS throw_default,
      coalesce((SELECT toInt64OrNull(value) FROM system.merge_tree_settings WHERE name = 'parts_to_delay_insert'), ${DEFAULT_PARTS_TO_DELAY_INSERT}) AS delay_default
  ),
  limits AS (
    SELECT
      p.database AS database,
      p.table AS table,
      p.partition AS partition,
      p.parts AS parts,
      if(o.throw_override > 0, o.throw_override, (SELECT throw_default FROM server_defaults)) AS throw_limit,
      if(o.delay_override > 0, o.delay_override, (SELECT delay_default FROM server_defaults)) AS delay_limit
    FROM parts_now p
    LEFT JOIN table_overrides o ON p.database = o.database AND p.table = o.table
    WHERE p.parts >= ${PARTS_PRESSURE_MIN_PARTS}
  )`
}

/**
 * Scalar query for the /health card + alert rule: the single worst partition's
 * fill percent (`active parts / parts_to_throw_insert * 100`). Higher-is-worse,
 * read via `valueKey: 'pressure_percent'`. Only needs `system.parts` /
 * `system.tables` / `system.merge_tree_settings` — no part_log dependency, so it
 * always works.
 */
export function buildPartsPressurePercentSql(): string {
  return `WITH ${effectiveLimitsCte()}
SELECT round(max(parts * 100.0 / nullIf(throw_limit, 0)), 1) AS pressure_percent
FROM limits`
}

/**
 * Projection query: per-partition current parts, effective throw/delay limits,
 * net part-growth rate from `system.part_log`, and the projected hours until the
 * partition breaches `parts_to_throw_insert`. Requires `system.part_log` (mark
 * the chart/collector `optional` + `tableCheck: 'system.part_log'`); use
 * {@link buildPartsPressureCurrentSql} as the graceful fallback.
 *
 * Net rate = (NewPart events − RemovePart events) over the rate window, per
 * partition: a positive net means parts are accumulating faster than merges
 * consume them. Rows are ordered worst-first — already-delaying partitions, then
 * the soonest projected breach.
 */
export function buildPartsPressureProjectionSql(opts?: {
  rateWindowHours?: number
  limit?: number
}): string {
  const windowHours = safeInt(
    opts?.rateWindowHours ?? PARTS_PRESSURE_RATE_WINDOW_HOURS,
    PARTS_PRESSURE_RATE_WINDOW_HOURS
  )
  const limit = safeInt(opts?.limit ?? 20, 20)
  return `WITH ${effectiveLimitsCte()},
  part_rate AS (
    SELECT
      database,
      table,
      partition,
      (countIf(event_type = 'NewPart') - countIf(event_type = 'RemovePart')) / ${windowHours}.0 AS net_parts_per_hour
    FROM system.part_log
    WHERE event_time > now() - INTERVAL ${windowHours} HOUR
      AND database NOT IN (${EXCLUDED_DATABASES})
    GROUP BY database, table, partition
  )
SELECT
  l.database AS database,
  l.table AS table,
  l.partition AS partition,
  l.parts AS parts,
  l.throw_limit AS throw_limit,
  l.delay_limit AS delay_limit,
  round(coalesce(r.net_parts_per_hour, 0), 2) AS net_parts_per_hour,
  l.parts >= l.delay_limit AS is_delaying,
  if(
    coalesce(r.net_parts_per_hour, 0) > 0 AND l.parts < l.throw_limit,
    round((l.throw_limit - l.parts) / r.net_parts_per_hour, 2),
    NULL
  ) AS hours_to_throw
FROM limits l
LEFT JOIN part_rate r ON l.database = r.database AND l.table = r.table AND l.partition = r.partition
ORDER BY is_delaying DESC, hours_to_throw ASC NULLS LAST, parts DESC
LIMIT ${limit}`
}

/**
 * Fallback query when `system.part_log` is disabled: per-partition current parts
 * and effective limits, no rate/projection columns. Ordered by raw fill so the
 * fullest partition leads.
 */
export function buildPartsPressureCurrentSql(opts?: {
  limit?: number
}): string {
  const limit = safeInt(opts?.limit ?? 20, 20)
  return `WITH ${effectiveLimitsCte()}
SELECT
  database,
  table,
  partition,
  parts,
  throw_limit,
  delay_limit,
  parts >= delay_limit AS is_delaying
FROM limits
ORDER BY parts * 1.0 / nullIf(throw_limit, 0) DESC
LIMIT ${limit}`
}

/** A single partition's projected pressure, parsed from a projection query row. */
export interface PartsPressureRow {
  database: string
  table: string
  partition: string
  parts: number
  throwLimit: number
  delayLimit: number
  /** Net parts/hour from part_log; null when part_log is unavailable. */
  netPartsPerHour: number | null
  /** Projected hours until parts reaches throwLimit; null when not projectable. */
  hoursToThrow: number | null
  isDelaying: boolean
}

/**
 * Project hours until a partition reaches its throw threshold. Returns null when
 * the net rate is non-positive (parts stable/shrinking — merges keeping up) or
 * inputs are invalid, and 0 when the partition has already reached the limit.
 * Pure — the projection query computes the same thing in SQL; this mirror is
 * what the fallback path and unit tests use.
 */
export function projectHoursToThreshold(
  currentParts: number,
  throwLimit: number,
  netPartsPerHour: number | null
): number | null {
  if (
    netPartsPerHour === null ||
    !Number.isFinite(netPartsPerHour) ||
    netPartsPerHour <= 0
  )
    return null
  if (
    !Number.isFinite(currentParts) ||
    !Number.isFinite(throwLimit) ||
    throwLimit <= 0
  )
    return null
  const remaining = throwLimit - currentParts
  if (remaining <= 0) return 0
  return remaining / netPartsPerHour
}

export type PartsPressureSeverity = 'info' | 'warning' | 'critical'

/**
 * Classify a partition's parts pressure into a severity, or null when it is not
 * worth surfacing. Encodes the PRD policy:
 * - already delaying (parts ≥ parts_to_delay_insert) → critical
 * - projected breach within the critical window (default 1h) → critical
 * - projected breach within the warn window (default 6h) → warning
 * - no projection (part_log off): fall back to raw fill — ≥ critical% → warning,
 *   ≥ warning% → info, else null
 * - projectable but breach is beyond the warn window → null (not imminent)
 */
export function classifyPartsPressure(input: {
  parts: number
  throwLimit: number
  delayLimit: number
  hoursToThrow: number | null
  warnWindowHours?: number
  criticalWindowHours?: number
}): PartsPressureSeverity | null {
  const {
    parts,
    throwLimit,
    delayLimit,
    hoursToThrow,
    warnWindowHours = PARTS_PRESSURE_WARN_WINDOW_HOURS,
    criticalWindowHours = PARTS_PRESSURE_CRITICAL_WINDOW_HOURS,
  } = input

  if (Number.isFinite(delayLimit) && delayLimit > 0 && parts >= delayLimit)
    return 'critical'

  if (hoursToThrow !== null && Number.isFinite(hoursToThrow)) {
    if (hoursToThrow <= criticalWindowHours) return 'critical'
    if (hoursToThrow <= warnWindowHours) return 'warning'
    return null
  }

  // No projection (part_log unavailable) — fall back to raw fill percent.
  const percent =
    throwLimit > 0 ? (parts * 100) / throwLimit : Number.POSITIVE_INFINITY
  if (percent >= PARTS_PRESSURE_PERCENT_CRITICAL) return 'warning'
  if (percent >= PARTS_PRESSURE_PERCENT_WARNING) return 'info'
  return null
}
