/** Size + impact estimation math for the MV/projection designer. Pure, no I/O. */

import { formatBytes } from '@/lib/utils'

export interface SizeEstimate {
  estimatedRows: number
  estimatedBytes: number
  readableEstimatedBytes: string
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

/** Size ≈ source parts size x (distinct grouping-key combinations / source rows). */
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
 * Scale a sample's distinct-combination count up to the table's row count by
 * the inverse sampling fraction (exact when the sample covers the table, never
 * above `sourceRows`). A rough heuristic, not an unbiased estimator: it tends
 * to overestimate when real cardinality is low relative to the sample.
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
