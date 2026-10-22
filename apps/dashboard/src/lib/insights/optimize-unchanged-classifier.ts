/**
 * OPTIMIZE FINAL on unchanged data: pure classifier + row-to-insight mapping.
 *
 * No I/O. The SQL lives in `optimize-unchanged-collector.ts`.
 *
 * Background (#4069, slice 3): `OPTIMIZE TABLE ... FINAL` rewrites every part
 * of a partition into one. When it runs on a schedule against a table that
 * received no new data since the previous run, the rewrite changes nothing and
 * only burns IO and CPU. This surfaces such a table so its owner can review
 * the schedule. It is evidence from `system.query_log` and `system.part_log`
 * on this host only, never a recommendation to change anything.
 */

import type { InsightCandidate } from './types'

/** Runs with no new data since the previous run needed to flag a table. */
export const OPTIMIZE_UNCHANGED_MIN_RUNS = 3
/** Look-back of the `query_log` / `part_log` read (they may hold less). */
export const OPTIMIZE_UNCHANGED_WINDOW_DAYS = 14

export interface OptimizeUnchangedRow {
  database: string
  table: string
  /** Successful `OPTIMIZE ... FINAL` statements in the window. */
  runs: number
  /**
   * Runs, other than the first, with no `NewPart` row for the table between
   * them and the previous run. The first run has nothing to compare against.
   */
  unchangedRuns: number
}

export interface OptimizeUnchangedVerdict {
  flagged: boolean
}

export function classifyOptimizeUnchanged(
  row: OptimizeUnchangedRow
): OptimizeUnchangedVerdict {
  // At most runs - 1 runs can be compared; a larger count is bad input.
  const comparable = Math.max(row.runs - 1, 0)
  const unchanged = Math.min(row.unchangedRuns, comparable)
  return { flagged: unchanged >= OPTIMIZE_UNCHANGED_MIN_RUNS }
}

export function optimizeUnchangedRowFromRecord(
  rec: Record<string, unknown>
): OptimizeUnchangedRow {
  const n = (v: unknown) => Number(v) || 0
  return {
    database: String(rec.database ?? ''),
    table: String(rec.table ?? ''),
    runs: n(rec.runs),
    unchangedRuns: n(rec.unchanged_runs),
  }
}

/**
 * Insights surfaced per sweep. OPTIMIZE schedules are per table, so a cluster
 * with many cron-driven tables could otherwise flood the feed with info cards;
 * the worst few are enough to point at the pattern.
 */
export const OPTIMIZE_UNCHANGED_MAX_INSIGHTS = 3

/** Up to three info insights, the tables with the most unchanged runs first. */
export function insightFromOptimizeUnchangedRows(
  rows: unknown
): InsightCandidate[] {
  if (!Array.isArray(rows)) return []
  const flagged: OptimizeUnchangedRow[] = []
  for (const raw of rows) {
    const row = optimizeUnchangedRowFromRecord(
      (raw ?? {}) as Record<string, unknown>
    )
    if (!row.database || !row.table) continue
    if (classifyOptimizeUnchanged(row).flagged) flagged.push(row)
  }
  flagged.sort((a, b) => b.unchangedRuns - a.unchangedRuns)

  return flagged.slice(0, OPTIMIZE_UNCHANGED_MAX_INSIGHTS).map((row) => {
    const fq = `${row.database}.${row.table}`
    return {
      severity: 'info',
      category: 'storage',
      // Table in the metric, count-free title: the dismissal key survives the
      // numbers changing. The prefix is matched in deriveAction.
      metric: `optimize_unchanged:${fq}`,
      title: `${fq} is optimized repeatedly with no new data`,
      detail:
        `${fq}: OPTIMIZE TABLE ... FINAL ran ${row.runs} times in the last ` +
        `${OPTIMIZE_UNCHANGED_WINDOW_DAYS} days (single replica: this host's ` +
        `query_log and part_log only), and ${row.unchangedRuns} of those runs ` +
        `had no new data inserted since the previous run. OPTIMIZE FINAL on ` +
        `data that did not change rewrites parts for nothing. Review whether ` +
        `this schedule is needed; nothing is changed.`,
      value: row.unchangedRuns,
      action: { label: 'View merges', href: '/merges' },
    } satisfies InsightCandidate
  })
}
