/**
 * Deterministic insight collectors.
 *
 * Each collector runs read-only queries against a single host and returns
 * candidate insights. Collectors NEVER throw — any query failure (missing
 * table, read-only cluster, permission) yields an empty list so the engine
 * degrades gracefully. The SQL/severity heuristics are ported from the agent's
 * anomaly and table-insight tools so the panel matches what the agent reports.
 */

import type { Baseline } from './statistical-baseline'
import type { InsightCandidate, InsightSeverity } from './types'

import { readOnlyQuery } from '../ai/agent/tools/helpers'
import {
  checkDetachedParts,
  checkFailedDictionaries,
  checkLongRunningQuery,
  checkStuckMutations,
} from './operational-checks'
import {
  type AnalyzedQuery,
  selectSchemaOptimizations,
} from './schema-optimizations'
import { refitBaselineIfStale, scoreAnomaly } from './statistical-baseline'

function extractValue(result: unknown): number | null {
  if (Array.isArray(result) && result.length > 0) {
    const row = result[0] as Record<string, unknown>
    const val = row.value
    const num = typeof val === 'number' ? val : Number(val)
    return Number.isFinite(num) ? num : null
  }
  return null
}

/** Extract a `value` column from every row (used to fit a 7-day baseline). */
function extractSamples(result: unknown): number[] {
  if (!Array.isArray(result)) return []
  const out: number[] = []
  for (const row of result) {
    const val = (row as Record<string, unknown>)?.value
    const num = typeof val === 'number' ? val : Number(val)
    if (Number.isFinite(num)) out.push(num)
  }
  return out
}

async function firstRow(
  sql: string,
  hostId: number
): Promise<Record<string, unknown> | null> {
  try {
    const rows = await readOnlyQuery({ query: sql, hostId })
    return Array.isArray(rows) && rows.length > 0
      ? (rows[0] as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Anomaly collector — recent (1h) vs baseline (24h), ported from anomaly-tools.
// ---------------------------------------------------------------------------

interface AnomalyCheck {
  metric: string
  title: string
  recentQuery: string
  baselineQuery: string
  /**
   * ~7-day, hourly-bucketed history of the same metric `recentQuery` reads,
   * used to fit this check's statistical baseline (see `statistical-baseline.ts`).
   * Must read the *same* underlying metric as `recentQuery`/`baselineQuery` —
   * scoring a value against a baseline fit from a different metric produces a
   * meaningless z-score.
   */
  sampleQuery: string
  /** Render the change into a human detail string (static-threshold fallback path). */
  format: (recent: number, baseline: number, changePct: number) => string
  classify: (changePct: number) => InsightSeverity
}

const round = (n: number) => Math.round(n * 100) / 100

const ANOMALY_CHECKS: AnomalyCheck[] = [
  {
    metric: 'error_rate',
    title: 'Query error rate is climbing',
    recentQuery: `SELECT countIf(type = 'ExceptionWhileProcessing') * 100.0 / nullIf(count(), 0) as value FROM system.query_log WHERE event_time > now() - INTERVAL 1 HOUR`,
    baselineQuery: `SELECT countIf(type = 'ExceptionWhileProcessing') * 100.0 / nullIf(count(), 0) as value FROM system.query_log WHERE event_time BETWEEN now() - INTERVAL 25 HOUR AND now() - INTERVAL 1 HOUR`,
    sampleQuery: `SELECT toStartOfHour(event_time) AS bucket, countIf(type = 'ExceptionWhileProcessing') * 100.0 / nullIf(count(), 0) AS value FROM system.query_log WHERE event_time > now() - INTERVAL 7 DAY GROUP BY bucket HAVING isNotNull(value) ORDER BY bucket`,
    format: (recent, baseline) =>
      `Error rate in the last hour is ${round(recent)}% vs a 24h baseline of ${round(baseline)}%. Investigate failing queries before they spread.`,
    classify: (pct) => (pct > 100 ? 'critical' : pct > 50 ? 'warning' : 'info'),
  },
  {
    metric: 'query_duration_p95',
    title: 'Queries are slowing down (p95)',
    recentQuery: `SELECT quantile(0.95)(query_duration_ms) as value FROM system.query_log WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 1 HOUR`,
    baselineQuery: `SELECT quantile(0.95)(query_duration_ms) as value FROM system.query_log WHERE type = 'QueryFinish' AND event_time BETWEEN now() - INTERVAL 25 HOUR AND now() - INTERVAL 1 HOUR`,
    sampleQuery: `SELECT toStartOfHour(event_time) AS bucket, quantile(0.95)(query_duration_ms) AS value FROM system.query_log WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 7 DAY GROUP BY bucket ORDER BY bucket`,
    format: (recent, baseline, pct) =>
      `p95 query duration rose ${round(pct)}% (now ${round(recent)}ms vs ${round(baseline)}ms baseline). Check for heavy scans or contention.`,
    classify: (pct) =>
      pct > 200 ? 'critical' : pct > 100 ? 'warning' : 'info',
  },
  {
    metric: 'memory_usage',
    title: 'Memory usage spiked',
    // Reads MemoryResident from asynchronous_metric_log (same metric as
    // baselineQuery/sampleQuery below) — a live system.metrics MemoryTracking
    // snapshot would score against a different metric's baseline and produce
    // a meaningless z-score.
    recentQuery: `SELECT avg(value) as value FROM system.asynchronous_metric_log WHERE metric = 'MemoryResident' AND event_time > now() - INTERVAL 1 HOUR`,
    baselineQuery: `SELECT avg(value) as value FROM system.asynchronous_metric_log WHERE metric = 'MemoryResident' AND event_time BETWEEN now() - INTERVAL 25 HOUR AND now() - INTERVAL 1 HOUR`,
    sampleQuery: `SELECT toStartOfHour(event_time) AS bucket, avg(value) AS value FROM system.asynchronous_metric_log WHERE metric = 'MemoryResident' AND event_time > now() - INTERVAL 7 DAY GROUP BY bucket ORDER BY bucket`,
    format: (_recent, _baseline, pct) =>
      `Tracked memory is ${round(pct)}% above the 24h average. Watch for OOM risk on memory-heavy queries.`,
    classify: (pct) => (pct > 80 ? 'critical' : pct > 40 ? 'warning' : 'info'),
  },
]

/** Above this |z|, a baseline-flagged anomaly is 'critical' rather than 'warning'. */
const CRITICAL_Z_THRESHOLD = 4

/** Outcome of reconciling the statistical baseline with the legacy static threshold. */
export interface AnomalySeverityDecision {
  /** `null` means suppress this candidate — it isn't worth surfacing. */
  readonly severity: InsightSeverity | null
  readonly usedBaseline: boolean
  /** z-score when `usedBaseline` is true; `null` otherwise. */
  readonly z: number | null
}

/**
 * Decide whether an anomaly check's current reading is worth surfacing, and at
 * what severity — the single point where the statistical baseline and the
 * legacy static-threshold path are reconciled. Exported so both collectors and
 * tests can reason about it as a pure function (no ClickHouse/store I/O).
 *
 * When a usable baseline exists (`scoreAnomaly(...).usedBaseline`), severity is
 * derived from the z-score: `|z| <= 2` is suppressed — this is what eliminates
 * false positives a fixed percentage threshold produces on a cluster whose
 * normal range differs from the default. `|z| > 4` is `critical`, otherwise
 * `warning`. Falls back to the existing `staticClassify(changePct)` (with
 * `'info'` suppressed, matching pre-baseline behavior) when there is no usable
 * baseline yet — cold start or a degenerate fit — so detection never regresses
 * before enough history accumulates.
 */
export function decideSeverity(
  recent: number,
  changePct: number,
  baseline: Baseline | null,
  staticClassify: (changePct: number) => InsightSeverity
): AnomalySeverityDecision {
  const score = scoreAnomaly(recent, baseline)

  if (score.usedBaseline) {
    if (!score.isAnomaly)
      return { severity: null, usedBaseline: true, z: score.z }
    return {
      severity:
        Math.abs(score.z) > CRITICAL_Z_THRESHOLD ? 'critical' : 'warning',
      usedBaseline: true,
      z: score.z,
    }
  }

  const severity = staticClassify(changePct)
  return {
    severity: severity === 'info' ? null : severity,
    usedBaseline: false,
    z: null,
  }
}

/** Detail string for the baseline-backed path — labels the signal as statistical, not a fixed default. */
function formatBaselineDetail(
  check: AnomalyCheck,
  recent: number,
  baseline: Baseline,
  z: number
): string {
  const direction = z >= 0 ? 'above' : 'below'
  return `${check.title}: the current value (${round(recent)}) is ${round(Math.abs(z))}σ ${direction} this cluster's own 7-day baseline (mean ${round(baseline.mean)}, stddev ${round(baseline.stddev)}, n=${baseline.sampleCount}). This threshold is statistically fitted per cluster, not a fixed default.`
}

async function collectAnomalies(hostId: number): Promise<InsightCandidate[]> {
  const out: InsightCandidate[] = []
  await Promise.all(
    ANOMALY_CHECKS.map(async (check) => {
      try {
        const [recentRes, baselineRes] = await Promise.all([
          readOnlyQuery({ query: check.recentQuery, hostId }).catch(() => null),
          readOnlyQuery({ query: check.baselineQuery, hostId }).catch(
            () => null
          ),
        ])
        const recent = extractValue(recentRes)
        const baselineAvg = extractValue(baselineRes)
        if (recent === null || baselineAvg === null || baselineAvg === 0) return

        const changePct = ((recent - baselineAvg) / Math.abs(baselineAvg)) * 100

        // Best-effort: reuse (or refit, if stale/missing) this metric's
        // statistical baseline. Any failure here resolves to null, which
        // decideSeverity treats the same as cold start — fail-open onto the
        // static classify below.
        const fittedBaseline = await refitBaselineIfStale(
          hostId,
          check.metric,
          () =>
            readOnlyQuery({ query: check.sampleQuery, hostId })
              .then(extractSamples)
              .catch(() => [])
        )

        const decision = decideSeverity(
          recent,
          changePct,
          fittedBaseline,
          check.classify
        )
        if (decision.severity === null) return

        const usedBaseline =
          decision.usedBaseline &&
          fittedBaseline !== null &&
          decision.z !== null

        out.push({
          severity: decision.severity,
          category: 'anomaly',
          metric: check.metric,
          title: check.title,
          detail: usedBaseline
            ? formatBaselineDetail(
                check,
                recent,
                fittedBaseline as Baseline,
                decision.z as number
              )
            : check.format(recent, baselineAvg, changePct),
          value: round(usedBaseline ? (decision.z as number) : changePct),
          action: {
            label: 'Open running queries',
            href: '/running-queries',
            prompt: `Why did ${check.metric} change recently on host ${hostId}? Detect anomalies and explain.`,
          },
        })
      } catch {
        // ignore — collector stays best-effort
      }
    })
  )
  return out
}

// ---------------------------------------------------------------------------
// Storage collector — fragmented tables + poor compression.
// ---------------------------------------------------------------------------

async function collectStorage(hostId: number): Promise<InsightCandidate[]> {
  const out: InsightCandidate[] = []

  // Highly fragmented table (many active parts → merge pressure, slow reads).
  const parts = await firstRow(
    `SELECT database, table, count() AS value,
       formatReadableSize(sum(bytes_on_disk)) AS size
     FROM system.parts WHERE active
     GROUP BY database, table
     ORDER BY value DESC
     LIMIT 1`,
    hostId
  )
  if (parts) {
    const partCount = Number(parts.value) || 0
    if (partCount >= 300) {
      out.push({
        severity: partCount >= 1000 ? 'warning' : 'info',
        category: 'storage',
        metric: 'max_active_parts',
        title: `${parts.database}.${parts.table} is fragmented`,
        detail: `${parts.database}.${parts.table} has ${partCount} active parts (${parts.size}). Consider OPTIMIZE or reviewing the partition key to cut merge overhead.`,
        value: partCount,
        action: { label: 'View tables', href: '/tables' },
      })
    }
  }

  // Worst compression on a sizeable table (ratio near 1 == barely compressed).
  const compression = await firstRow(
    `SELECT database, table,
       round(sum(data_compressed_bytes) * 1.0 / nullIf(sum(data_uncompressed_bytes), 0), 3) AS value,
       formatReadableSize(sum(data_uncompressed_bytes)) AS uncompressed
     FROM system.parts WHERE active
     GROUP BY database, table
     HAVING sum(data_uncompressed_bytes) > 1073741824
     ORDER BY value DESC
     LIMIT 1`,
    hostId
  )
  if (compression) {
    const ratio = Number(compression.value) || 0
    if (ratio >= 0.7) {
      out.push({
        severity: 'info',
        category: 'storage',
        metric: 'worst_compression_ratio',
        title: `Poor compression on ${compression.database}.${compression.table}`,
        detail: `${compression.database}.${compression.table} (${compression.uncompressed} uncompressed) compresses to ${Math.round(ratio * 100)}% of its size. A better codec (ZSTD/Delta) or column ordering could reclaim storage.`,
        value: ratio,
        action: {
          label: 'Ask the agent',
          prompt: `Suggest compression improvements for ${compression.database}.${compression.table}.`,
        },
      })
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Reliability collector — readonly replicas + replication lag.
// ---------------------------------------------------------------------------

async function collectReliability(hostId: number): Promise<InsightCandidate[]> {
  const out: InsightCandidate[] = []

  const readonly = await firstRow(
    `SELECT count() AS value FROM system.replicas WHERE is_readonly`,
    hostId
  )
  if (readonly) {
    const count = Number(readonly.value) || 0
    if (count > 0) {
      out.push({
        severity: 'critical',
        category: 'reliability',
        metric: 'readonly_replicas',
        title: `${count} replica${count > 1 ? 's are' : ' is'} read-only`,
        detail: `${count} replicated table${count > 1 ? 's' : ''} entered read-only mode — usually a ZooKeeper/Keeper connectivity problem. Writes to these tables are blocked.`,
        value: count,
        action: { label: 'View replicas', href: '/replicas' },
      })
    }
  }

  const lag = await firstRow(
    `SELECT max(absolute_delay) AS value FROM system.replicas`,
    hostId
  )
  if (lag) {
    const seconds = Number(lag.value) || 0
    if (seconds >= 60) {
      out.push({
        severity: seconds >= 600 ? 'warning' : 'info',
        category: 'reliability',
        metric: 'max_replication_delay',
        title: 'Replication is lagging',
        detail: `The most-delayed replica is ${Math.round(seconds)}s behind. Sustained lag risks stale reads and growing replication queues.`,
        value: Math.round(seconds),
        action: { label: 'View replicas', href: '/replicas' },
      })
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Operational collector — cheap point-in-time health checks across storage,
// reliability and performance (each a single count/aggregate on a small system
// table). Classification lives in ./operational-checks so it is unit-tested as
// pure functions; this layer only owns the SQL.
// ---------------------------------------------------------------------------

async function collectOperational(hostId: number): Promise<InsightCandidate[]> {
  const out: InsightCandidate[] = []

  // Detached parts — leftovers from failed merges / DETACH; disk without value.
  const detached = await firstRow(
    `SELECT count() AS value FROM system.detached_parts`,
    hostId
  )
  if (detached) {
    const candidate = checkDetachedParts(Number(detached.value) || 0)
    if (candidate) out.push(candidate)
  }

  // Stuck mutations — not done yet but already carrying a failure reason.
  const mutations = await firstRow(
    `SELECT count() AS value FROM system.mutations WHERE is_done = 0 AND latest_fail_reason != ''`,
    hostId
  )
  if (mutations) {
    const candidate = checkStuckMutations(Number(mutations.value) || 0)
    if (candidate) out.push(candidate)
  }

  // Long-running live query — the single longest currently-executing query,
  // excluding this collector's own probe of system.processes.
  const longRunning = await firstRow(
    `SELECT count() AS value, max(elapsed) AS max_elapsed FROM system.processes WHERE elapsed > 60 AND query NOT ILIKE '%system.processes%'`,
    hostId
  )
  if (longRunning) {
    const candidate = checkLongRunningQuery(
      Number(longRunning.max_elapsed) || 0,
      Number(longRunning.value) || 0
    )
    if (candidate) out.push(candidate)
  }

  // Dictionaries stuck in the FAILED state — every query using them errors.
  const dictionaries = await firstRow(
    `SELECT count() AS value FROM system.dictionaries WHERE status = 'FAILED'`,
    hostId
  )
  if (dictionaries) {
    const candidate = checkFailedDictionaries(Number(dictionaries.value) || 0)
    if (candidate) out.push(candidate)
  }

  return out
}

// ---------------------------------------------------------------------------
// Schema-optimization collector — reuses the query advisor's `analyzeQuery`
// (skip index / projection / partition key / PREWHERE) against a few
// representative heavy recent queries and surfaces the ranked recommendations
// as "Optimization" insights. Read-only end to end (EXPLAIN + system tables);
// the pure ranking/mapping lives in ./schema-optimizations so it is unit-tested.
// ---------------------------------------------------------------------------

/** How many representative queries to analyze per sweep (bounds ClickHouse round-trips). */
const SCHEMA_OPT_MAX_QUERIES = 3

/**
 * A few of the heaviest recent SELECTs, one per normalized query shape, so the
 * advisor analyzes distinct workloads rather than the same query repeated.
 */
const HEAVY_QUERIES_SQL = `SELECT any(query) AS query
  FROM system.query_log
  WHERE type = 'QueryFinish'
    AND event_time > now() - INTERVAL 24 HOUR
    AND query_kind = 'Select'
    AND read_bytes > 10000000
    AND query NOT ILIKE '%system.%'
  GROUP BY normalized_query_hash
  ORDER BY max(read_bytes) DESC
  LIMIT ${SCHEMA_OPT_MAX_QUERIES}`

async function collectSchemaOptimizations(
  hostId: number
): Promise<InsightCandidate[]> {
  try {
    const rows = await readOnlyQuery({
      query: HEAVY_QUERIES_SQL,
      hostId,
    }).catch(() => null)
    if (!Array.isArray(rows) || rows.length === 0) return []

    const queries = rows
      .map((r) => (r as Record<string, unknown>)?.query)
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    if (queries.length === 0) return []

    // Dynamic import (like advisor-tools.ts) keeps the heavy recommendation
    // engine out of anything that merely imports the collectors module.
    const { analyzeQuery } = await import('../ai/advisor/recommendation-engine')

    const analyzed = await Promise.all(
      queries.map(async (sql): Promise<AnalyzedQuery | null> => {
        try {
          const res = await analyzeQuery({ hostId, sql })
          if (!res.ok || res.recommendations.length === 0) return null
          return {
            database: res.database,
            table: res.table,
            recommendations: res.recommendations,
          }
        } catch {
          return null
        }
      })
    )

    return selectSchemaOptimizations(
      analyzed.filter((a): a is AnalyzedQuery => a !== null)
    )
  } catch {
    return []
  }
}

/**
 * Run all collectors for a host and return de-duplicated candidates,
 * highest severity first.
 */
export async function collectInsights(
  hostId: number
): Promise<InsightCandidate[]> {
  const groups = await Promise.all([
    collectAnomalies(hostId).catch(() => []),
    collectStorage(hostId).catch(() => []),
    collectReliability(hostId).catch(() => []),
    collectOperational(hostId).catch(() => []),
    collectSchemaOptimizations(hostId).catch(() => []),
  ])

  const seen = new Set<string>()
  const merged: InsightCandidate[] = []
  for (const candidate of groups.flat()) {
    const dedupeKey = `${candidate.category}:${candidate.metric ?? candidate.title}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    merged.push(candidate)
  }

  const rank: Record<InsightSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  }
  return merged.sort((a, b) => rank[a.severity] - rank[b.severity])
}
