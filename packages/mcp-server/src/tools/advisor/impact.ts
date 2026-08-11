/**
 * Impact estimation / presentation for the query advisor (see
 * `../advisor.ts` header for the duplication note this whole `advisor/` tree
 * inherits).
 */

import type { EstimatedImpact } from './types'

export function estimateBytesSaved(
  granulesSaved: number,
  granulesTotal: number,
  tableBytes: number
): number {
  if (granulesTotal <= 0 || granulesSaved <= 0) return 0
  const fraction = Math.min(1, granulesSaved / granulesTotal)
  return Math.round(fraction * tableBytes)
}

export function formatBytesShort(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KiB`
  return `${bytes} B`
}

export function summarizeImpact(input: {
  granulesRead: number
  granulesTotal: number
  granulesSaved: number
  tableBytes: number
  unknown: boolean
  label: string
}): EstimatedImpact {
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
    summary: `Estimated upper bound: up to ~${granulesSaved.toLocaleString()} granules (${pct}% of the table, ~${formatBytesShort(bytesSaved)}) currently read could be avoided with ${label}. This is an ESTIMATE from EXPLAIN + parts statistics, not a measured result — actual savings depend on data distribution.`,
  }
}
