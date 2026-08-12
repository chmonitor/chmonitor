/**
 * Query advisor — impact estimation (pure).
 *
 * Translates EXPLAIN granule/part counts + table byte totals into a rough
 * "bytes read saved" figure, and turns a before/after `EXPLAIN ESTIMATE` mark
 * comparison into the PREWHERE rewrite's validation verdict.
 *
 * Every number here is explicitly an ESTIMATE — see `summarizeImpact`'s
 * `summary` text, which always says so. Nothing in this file does I/O: the two
 * `EXPLAIN ESTIMATE` calls behind `summarizePrewhereMarks` are issued by the
 * caller's read-only fetcher, which then hands the mark counts to this module.
 */

import type { EstimatedImpact } from './types'

/**
 * Byte formatter used in the estimate summaries. Kept byte-identical to the
 * dashboard's `formatBytes` (`apps/dashboard/src/lib/utils.ts`) so both
 * advisor surfaces phrase the same estimate the same way — a package cannot
 * import app code (depcruise `no-packages-to-apps`), so this is the shared
 * copy the app defers to for advisor summaries.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 0) return '-'
  if (!Number.isFinite(bytes) || Number.isNaN(bytes)) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const safeIndex = Math.min(Math.max(i, 0), sizes.length - 1)
  return `${(bytes / k ** safeIndex).toFixed(1)} ${sizes[safeIndex]}`
}

/**
 * Estimate bytes read saved from a granules-saved figure, proportional to the
 * table's total bytes on disk. This is a rough average-bytes-per-granule
 * projection, not a per-column measurement — labeled as an estimate
 * everywhere it's surfaced.
 */
export function estimateBytesSaved(
  granulesSaved: number,
  granulesTotal: number,
  tableBytes: number
): number {
  if (granulesTotal <= 0 || granulesSaved <= 0) return 0
  const fraction = Math.min(1, granulesSaved / granulesTotal)
  return Math.round(fraction * tableBytes)
}

export interface SummarizeImpactInput {
  granulesRead: number
  granulesTotal: number
  granulesSaved: number
  tableBytes: number
  unknown: boolean
  label: string
}

/** Build an `EstimatedImpact` with an honest, explicitly-labeled-as-estimate summary. */
export function summarizeImpact(input: SummarizeImpactInput): EstimatedImpact {
  const {
    granulesRead,
    granulesTotal,
    granulesSaved,
    tableBytes,
    unknown,
    label,
  } = input

  if (unknown) {
    return {
      granulesSaved: 0,
      granulesRead,
      bytesSaved: 0,
      unknown: true,
      summary: `Impact could not be estimated (no EXPLAIN data available for this table) — ${label} may still help, but the granules/bytes saved are unknown rather than guessed.`,
    }
  }

  const bytesSaved = estimateBytesSaved(
    granulesSaved,
    granulesTotal,
    tableBytes
  )
  const pct =
    granulesTotal > 0 ? Math.round((granulesSaved / granulesTotal) * 100) : 0

  return {
    granulesSaved,
    granulesRead,
    bytesSaved,
    unknown: false,
    summary: `Estimated upper bound: up to ~${granulesSaved.toLocaleString()} granules (${pct}% of the table, ~${formatBytes(bytesSaved)}) currently read could be avoided with ${label}. This is an ESTIMATE from EXPLAIN + parts statistics, not a measured result — actual savings depend on data distribution.`,
  }
}

/** Sum the `marks` column of an `EXPLAIN ESTIMATE` result set, tolerating string/undefined values. */
export function sumEstimateMarks(
  rows: Array<{ marks?: number | string }>
): number {
  return rows.reduce((sum, row) => sum + Number(row.marks ?? 0), 0)
}

export interface PrewhereMarksInput {
  beforeMarks: number
  afterMarks: number
  movedColumn: string
}

/**
 * Turn a before/after `EXPLAIN ESTIMATE` mark comparison into the PREWHERE
 * rewrite's verdict.
 *
 * EXPLAIN ESTIMATE reflects granules selected by the primary key/parts
 * pruning, which PREWHERE alone does not change (PREWHERE still reads the
 * same granules, just avoids materializing wide columns for filtered-out rows
 * within them) — so an increase means the rewrite altered pruning, i.e. a real
 * regression signal worth surfacing plainly.
 */
export function summarizePrewhereMarks(
  input: PrewhereMarksInput
): EstimatedImpact {
  const { beforeMarks, afterMarks, movedColumn } = input

  if (afterMarks > beforeMarks) {
    return {
      granulesSaved: 0,
      granulesRead: beforeMarks,
      bytesSaved: 0,
      unknown: false,
      summary: `Rewrite validation: EXPLAIN ESTIMATE shows the PREWHERE rewrite reads MORE granules after (${afterMarks}) than before (${beforeMarks}) — do not apply this rewrite as-is; the estimate suggests it could regress the plan.`,
    }
  }

  return {
    granulesSaved: 0,
    granulesRead: beforeMarks,
    bytesSaved: 0,
    unknown: false,
    summary: `Rewrite validated: EXPLAIN ESTIMATE shows unchanged granule selection before/after (${beforeMarks} granules) — moving \`${movedColumn}\` to PREWHERE avoids materializing other columns for rows filtered out by it, without changing which granules are read.`,
  }
}

export interface PrewhereFallbackInput {
  /** Used only when the before/after EXPLAIN comparison itself fails. */
  fallbackGranulesRead: number
  fallbackGranulesTotal: number
  tableBytes: number
  movedColumn: string
}

/** Degraded (but still honest) PREWHERE impact for when `EXPLAIN ESTIMATE` cannot be run at all. */
export function prewhereFallbackImpact(
  input: PrewhereFallbackInput
): EstimatedImpact {
  return summarizeImpact({
    granulesRead: input.fallbackGranulesRead,
    granulesTotal: input.fallbackGranulesTotal,
    granulesSaved: input.fallbackGranulesRead,
    tableBytes: input.tableBytes,
    unknown: input.fallbackGranulesTotal === 0,
    label: `moving \`${input.movedColumn}\` to PREWHERE`,
  })
}
