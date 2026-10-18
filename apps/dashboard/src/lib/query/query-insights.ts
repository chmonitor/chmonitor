/**
 * Keep the bar conservative — only flag what is clearly actionable, so the
 * section earns trust rather than crying wolf.
 */

export interface QueryInsightInput {
  query?: string
  query_kind?: string
  type?: string
  exception_code?: number | string
  exception_text?: string
  query_duration?: number | string
  read_rows?: number | string
  result_rows?: number | string
  written_rows?: number | string
  memory_usage?: number | string
  /** query_log.query_cache_usage — a 0..1 ratio. */
  query_cache_usage?: number | string
}

export type InsightSeverity = 'critical' | 'warning' | 'info'

export interface QueryInsight {
  id: string
  severity: InsightSeverity
  title: string
  detail: string
}

const DURATION_WARN_S = 10
const DURATION_CRITICAL_S = 60
const MEMORY_WARN_B = 1_000_000_000 // 1 GB
const MEMORY_CRITICAL_B = 10_000_000_000 // 10 GB
/** Flag low selectivity only when both non-trivial: avoids noise on tiny scans. */
const SELECTIVITY_MIN_READ = 1_000_000
const SELECTIVITY_RATIO = 1000

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function looksLikeSelect(query: string): boolean {
  return /\bSELECT\b/i.test(query) || /\bWITH\b/i.test(query)
}

function hasWhereClause(query: string): boolean {
  return /\bWHERE\b/i.test(query)
}

export function deriveQueryInsights(row: QueryInsightInput): QueryInsight[] {
  const insights: QueryInsight[] = []

  const duration = toNum(row.query_duration)
  const memory = toNum(row.memory_usage)
  const readRows = toNum(row.read_rows)
  const resultRows = toNum(row.result_rows)
  const exceptionCode = toNum(row.exception_code)
  const query = row.query ?? ''

  if (exceptionCode !== 0) {
    insights.push({
      id: 'exception',
      severity: 'critical',
      title: 'Query ended with an error',
      detail: row.exception_text
        ? `${row.exception_text.split('\n')[0].slice(0, 200)} (code ${exceptionCode})`
        : `Exception code ${exceptionCode}`,
    })
  }

  if (duration >= DURATION_CRITICAL_S) {
    insights.push({
      id: 'duration-critical',
      severity: 'critical',
      title: 'Very slow query',
      detail: `${duration.toFixed(2)}s — beyond the 60s "very slow" threshold.`,
    })
  } else if (duration >= DURATION_WARN_S) {
    insights.push({
      id: 'duration-warn',
      severity: 'warning',
      title: 'Slow query',
      detail: `${duration.toFixed(2)}s — over the 10s slow-query threshold.`,
    })
  }

  if (memory >= MEMORY_CRITICAL_B) {
    insights.push({
      id: 'memory-critical',
      severity: 'critical',
      title: 'Very high memory usage',
      detail:
        'Over 10 GB — risk of OOM cancellations on memory-constrained nodes.',
    })
  } else if (memory >= MEMORY_WARN_B) {
    insights.push({
      id: 'memory-warn',
      severity: 'warning',
      title: 'High memory usage',
      detail:
        'Over 1 GB — worth checking for broad scans or missing aggregation limits.',
    })
  }

  // Full-scan heuristic — SELECT without a WHERE. Deliberately info-level
  //    (a missing WHERE is sometimes intended, e.g. small dimension tables).
  if (query && looksLikeSelect(query) && !hasWhereClause(query)) {
    insights.push({
      id: 'no-where',
      severity: 'info',
      title: 'No WHERE clause',
      detail:
        'This read has no filter — if the table is large, consider adding a predicate to avoid a full scan.',
    })
  }

  // Low selectivity — read a lot, returned a little. Only when material.
  if (
    readRows >= SELECTIVITY_MIN_READ &&
    resultRows > 0 &&
    readRows / resultRows >= SELECTIVITY_RATIO
  ) {
    insights.push({
      id: 'low-selectivity',
      severity: 'info',
      title: 'Low selectivity',
      detail: `Read ${readRows.toLocaleString()} rows to return ${resultRows.toLocaleString()} — a tighter filter or pre-aggregation could cut the scan.`,
    })
  }

  const order: Record<InsightSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  }
  return insights.sort((a, b) => order[a.severity] - order[b.severity])
}
