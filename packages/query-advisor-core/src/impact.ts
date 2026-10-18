/**
 * Impact estimation (pure): granule/part counts + table bytes become a rough
 * "bytes read saved" figure, and before/after `EXPLAIN ESTIMATE` marks become
 * the PREWHERE verdict. Every number is an ESTIMATE and the summaries say so.
 */

import type { EstimatedImpact } from './types'

/**
 * Kept byte-identical to the dashboard's `formatBytes`
 * (`apps/dashboard/src/lib/utils.ts`); a package cannot import app code
 * (depcruise `no-packages-to-apps`).
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

/** Average-bytes-per-granule projection, not a per-column measurement. */
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
 * EXPLAIN ESTIMATE reflects primary-key/parts pruning, which PREWHERE alone does
 * not change, so an increase means the rewrite altered pruning: a real
 * regression signal.
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
