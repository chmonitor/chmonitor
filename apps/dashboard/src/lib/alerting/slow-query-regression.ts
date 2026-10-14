/**
 * Slow Query Regression Detection (#1921)
 *
 * Detects query fingerprints whose P95 execution time has regressed
 * significantly between a current window and a baseline window.
 *
 * Fingerprint normalization strips literals (numbers, strings, bind params)
 * so that structurally identical queries are grouped regardless of values.
 *
 * The regression SQL runs entirely in ClickHouse — no client-side aggregation.
 */

/**
 * Normalize a raw SQL string to a stable fingerprint for grouping.
 *
 * Strips:
 * - Single-quoted string literals → '?'
 * - Bare integer/float literals → ?
 * - Named bind parameters {param:Type} → ?
 * - IN (...) list values → IN (?)
 * - Excess whitespace
 */
export function normalizeQueryFingerprint(sql: string): string {
  return sql
    .replace(/\{[^}]+\}/g, '?') // {param:Type} bind params
    .replace(/'(?:[^'\\]|\\.)*'/g, "'?'") // single-quoted strings
    .replace(/\b\d+(\.\d+)?\b/g, '?') // numeric literals
    .replace(/\bIN\s*\([^)]+\)/gi, 'IN (?)') // IN (...) list collapsing
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim()
    .toLowerCase()
}

/**
 * Build the regression-detection SQL.
 *
 * Compares P95 `query_duration_ms` for each normalized fingerprint between:
 *   - current_window_hours (most recent period)
 *   - baseline_window_hours (older comparison period immediately before current)
 *
 * Returns fingerprints where the current P95 is >= regressionFactor × baseline.
 * Excludes fingerprints with fewer than minSamples in either window to reduce noise.
 */
export function buildRegressionSQL(opts?: {
  currentWindowHours?: number
  baselineWindowHours?: number
  regressionFactor?: number
  minSamples?: number
  maxResults?: number
}): string {
  const {
    currentWindowHours = 1,
    baselineWindowHours = 24,
    regressionFactor = 2,
    minSamples = 3,
    maxResults = 20,
  } = opts ?? {}

  return `
WITH
  now() AS ref_time,
  ref_time - INTERVAL ${currentWindowHours} HOUR AS current_start,
  current_start - INTERVAL ${baselineWindowHours} HOUR AS baseline_start,
  current_data AS (
    SELECT
      replaceRegexpAll(
        replaceRegexpAll(
          replaceRegexpAll(
            lower(trimBoth(query)),
            '(''[^'']*''|\\b\\d+(?:\\.\\d+)?\\b|\\{[^}]+\\})',
            '?'
          ),
          '\\s+',
          ' '
        ),
        'in\\s*\\([^)]+\\)',
        'in (?)'
      ) AS fingerprint,
      query_duration_ms
    FROM system.query_log
    WHERE type = 'QueryFinish'
      AND event_time >= current_start
      AND event_time < ref_time
      AND query NOT LIKE '%system.%'
      AND is_initial_query = 1
  ),
  baseline_data AS (
    SELECT
      replaceRegexpAll(
        replaceRegexpAll(
          replaceRegexpAll(
            lower(trimBoth(query)),
            '(''[^'']*''|\\b\\d+(?:\\.\\d+)?\\b|\\{[^}]+\\})',
            '?'
          ),
          '\\s+',
          ' '
        ),
        'in\\s*\\([^)]+\\)',
        'in (?)'
      ) AS fingerprint,
      query_duration_ms
    FROM system.query_log
    WHERE type = 'QueryFinish'
      AND event_time >= baseline_start
      AND event_time < current_start
      AND query NOT LIKE '%system.%'
      AND is_initial_query = 1
  ),
  current_stats AS (
    SELECT
      fingerprint,
      count() AS current_count,
      round(quantile(0.95)(query_duration_ms)) AS current_p95_ms,
      round(avg(query_duration_ms)) AS current_avg_ms
    FROM current_data
    GROUP BY fingerprint
    HAVING current_count >= ${minSamples}
  ),
  baseline_stats AS (
    SELECT
      fingerprint,
      count() AS baseline_count,
      round(quantile(0.95)(query_duration_ms)) AS baseline_p95_ms,
      round(avg(query_duration_ms)) AS baseline_avg_ms
    FROM baseline_data
    GROUP BY fingerprint
    HAVING baseline_count >= ${minSamples}
  )
SELECT
  c.fingerprint,
  c.current_count,
  c.current_p95_ms,
  c.current_avg_ms,
  b.baseline_count,
  b.baseline_p95_ms,
  b.baseline_avg_ms,
  round(c.current_p95_ms / nullIf(b.baseline_p95_ms, 0), 2) AS regression_factor,
  substr(c.fingerprint, 1, 200) AS fingerprint_short
FROM current_stats c
INNER JOIN baseline_stats b USING (fingerprint)
WHERE c.current_p95_ms >= b.baseline_p95_ms * ${regressionFactor}
  AND b.baseline_p95_ms > 100
ORDER BY regression_factor DESC
LIMIT ${maxResults}
`
}

export interface SlowQueryRegression {
  fingerprint: string
  fingerprint_short: string
  current_count: number
  current_p95_ms: number
  current_avg_ms: number
  baseline_count: number
  baseline_p95_ms: number
  baseline_avg_ms: number
  regression_factor: number
  [key: string]: string | number
}

export interface RegressionSummary {
  count: number
  worst_factor: number
  worst_fingerprint: string
}

/**
 * Summarize a list of regressions for alert threshold evaluation.
 * Returns null when there are no regressions.
 */
export function summarizeRegressions(
  rows: SlowQueryRegression[]
): RegressionSummary | null {
  if (rows.length === 0) return null
  const worst = rows.reduce((a, b) =>
    a.regression_factor > b.regression_factor ? a : b
  )
  return {
    count: rows.length,
    worst_factor: worst.regression_factor,
    worst_fingerprint: worst.fingerprint_short,
  }
}
