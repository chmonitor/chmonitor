/**
 * D1-backed store for per-host/per-metric statistical anomaly baselines.
 *
 * Persists the fitted mean/stddev (+ median/MAD diagnostics) computed by
 * `statistical-baseline.ts` so collectors can score the current value against
 * a per-cluster baseline instead of a fixed static threshold. Reuses the same
 * `CHM_CLOUD_D1` binding as the agent's conversation store
 * (`conversation-store/d1-store.ts`); the table itself is created by the
 * `anomaly_baselines` migration in `db/conversations-migrations`.
 *
 * Best-effort like every other insights backend: a missing binding, an
 * unmigrated table, or any other D1 error is caught, logged, and resolved to
 * `null` / `[]` / void rather than thrown — so a deployment with no D1
 * configured (the OSS/self-hosted default) simply never gets a baseline, and
 * callers fall back to the static thresholds (fail-open; see
 * plans/48-statistical-anomaly-baselines.md).
 */

import type { Baseline } from './baseline-types'

import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const COMPONENT = 'anomaly-baseline-store'
const warn = (msg: string) =>
  ErrorLogger.logWarning(`[anomaly-baseline-store] ${msg}`, {
    component: COMPONENT,
  })

const TABLE = 'anomaly_baselines'

/** D1 row shape (nullable columns for optional MAD/median diagnostics). */
interface D1BaselineRow {
  host_id: string
  metric: string
  mean: number
  stddev: number
  median: number | null
  mad: number | null
  sample_count: number
  window_start: number | null
  fitted_at: number
}

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

function rowToBaseline(row: D1BaselineRow): Baseline {
  return {
    hostId: row.host_id,
    metric: row.metric,
    mean: row.mean,
    stddev: row.stddev,
    median: row.median ?? 0,
    mad: row.mad ?? 0,
    sampleCount: row.sample_count,
    windowStart: row.window_start ?? 0,
    fittedAt: row.fitted_at,
  }
}

/**
 * Read the fitted baseline for a host/metric.
 * Returns `null` when none exists yet, D1 is unavailable, or the read fails.
 */
export async function getBaseline(
  hostId: string,
  metric: string
): Promise<Baseline | null> {
  try {
    const db = getDb()
    if (!db) return null

    const row = await db
      .prepare(
        `SELECT host_id, metric, mean, stddev, median, mad, sample_count, window_start, fitted_at
         FROM ${TABLE} WHERE host_id = ?1 AND metric = ?2`
      )
      .bind(hostId, metric)
      .first<D1BaselineRow>()

    return row ? rowToBaseline(row) : null
  } catch (err) {
    warn(`failed to read baseline for ${hostId}/${metric}: ${err}`)
    return null
  }
}

/**
 * Upsert a fitted baseline (keyed on host_id + metric).
 * Best-effort — logs and resolves on failure, never throws.
 */
export async function upsertBaseline(baseline: Baseline): Promise<void> {
  try {
    const db = getDb()
    if (!db) return

    await db
      .prepare(
        `INSERT INTO ${TABLE}
           (host_id, metric, mean, stddev, median, mad, sample_count, window_start, fitted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (host_id, metric) DO UPDATE SET
           mean = excluded.mean,
           stddev = excluded.stddev,
           median = excluded.median,
           mad = excluded.mad,
           sample_count = excluded.sample_count,
           window_start = excluded.window_start,
           fitted_at = excluded.fitted_at`
      )
      .bind(
        baseline.hostId,
        baseline.metric,
        baseline.mean,
        baseline.stddev,
        baseline.median,
        baseline.mad,
        baseline.sampleCount,
        baseline.windowStart,
        baseline.fittedAt
      )
      .run()
  } catch (err) {
    warn(
      `failed to upsert baseline for ${baseline.hostId}/${baseline.metric}: ${err}`
    )
  }
}

/**
 * List all fitted baselines for a host, ordered by metric.
 * Best-effort — returns `[]` on any failure.
 */
export async function listBaselines(hostId: string): Promise<Baseline[]> {
  try {
    const db = getDb()
    if (!db) return []

    const result = await db
      .prepare(
        `SELECT host_id, metric, mean, stddev, median, mad, sample_count, window_start, fitted_at
         FROM ${TABLE} WHERE host_id = ?1
         ORDER BY metric`
      )
      .bind(hostId)
      .all<D1BaselineRow>()

    return (result.results ?? []).map(rowToBaseline)
  } catch (err) {
    warn(`failed to list baselines for ${hostId}: ${err}`)
    return []
  }
}
