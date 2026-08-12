/**
 * Size + impact estimation math for the MV/projection designer. Pure, no I/O.
 *
 * See `./index.ts` for the module overview.
 */

import { formatBytes } from '@/lib/utils'

export interface SizeEstimate {
  /** Estimated row count for the MV/projection — approximated by the estimated distinct grouping-key combinations. */
  estimatedRows: number
  estimatedBytes: number
  readableEstimatedBytes: string
  /** distinctCombinations / sourceRows, clamped to [0, 1]. */
  aggregationRatio: number
  label: 'estimate'
}

export interface ImpactEstimate {
  callsInWindow: number
  currentReadBytesTotal: number
  estimatedBytesSavedTotal: number
  label: 'estimate'
}

export interface SizeEstimateInput {
  sourceRows: number
  sourceBytes: number
  distinctCombinations: number
}

/**
 * MV/projection size ≈ source parts size × aggregation ratio, where the
 * ratio is `distinct grouping-key combinations / source rows`. Estimated
 * rows is approximated by the distinct-combination count (what the
 * table/projection converges to once merges finalize duplicate keys).
 */
export function estimateMvSize(input: SizeEstimateInput): SizeEstimate {
  const { sourceRows, sourceBytes, distinctCombinations } = input
  const ratio =
    sourceRows > 0
      ? Math.min(1, Math.max(0, distinctCombinations / sourceRows))
      : 0
  const estimatedBytes = Math.round(sourceBytes * ratio)
  return {
    estimatedRows: Math.round(distinctCombinations),
    estimatedBytes,
    readableEstimatedBytes: formatBytes(estimatedBytes),
    aggregationRatio: ratio,
    label: 'estimate',
  }
}

/**
 * Scale a distinct-combination count observed in a bounded sample up to the
 * full table's row count by the inverse sampling fraction. Exact (no
 * scaling) when the sample already covers the whole table. Never exceeds
 * `sourceRows` (can't have more distinct combinations than rows).
 *
 * Honest caveat (labeled in the output as an "estimate", not hidden): linear
 * scaling of a sample's distinct count is a rough heuristic, not an
 * unbiased estimator — true cardinality-from-a-sample estimation is a
 * harder statistical problem. This tends to *overestimate* the true
 * distinct count when the grouping key's real cardinality is low/moderate
 * relative to the sample size (the sample already sees most distinct values
 * with little room left to find "new" ones, but scaling assumes the sample's
 * rate of finding new values holds for the rest of the table too). It's
 * cheapest/safest in the common case this tool targets — pre-aggregation
 * candidates where the whole point is that distinct combinations are far
 * fewer than rows — and never requires a full-table scan.
 */
export function scaleCardinality(
  sampleDistinct: number,
  sampleSize: number,
  sourceRows: number
): number {
  if (sampleSize <= 0 || sourceRows <= 0) return 0
  if (sourceRows <= sampleSize) return Math.min(sampleDistinct, sourceRows)
  const scaled = Math.round(sampleDistinct * (sourceRows / sampleSize))
  return Math.min(scaled, sourceRows)
}

export function estimateImpact(input: {
  callsInWindow: number
  totalReadBytes: number
  mvEstimatedBytes: number
}): ImpactEstimate {
  const { callsInWindow, totalReadBytes, mvEstimatedBytes } = input
  const perCallCurrent = callsInWindow > 0 ? totalReadBytes / callsInWindow : 0
  const perCallSaved = Math.max(0, perCallCurrent - mvEstimatedBytes)
  return {
    callsInWindow,
    currentReadBytesTotal: Math.round(totalReadBytes),
    estimatedBytesSavedTotal: Math.round(perCallSaved * callsInWindow),
    label: 'estimate',
  }
}
