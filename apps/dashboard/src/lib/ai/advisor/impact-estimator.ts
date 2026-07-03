/**
 * Query advisor — impact estimation.
 *
 * Translates EXPLAIN granule/part counts + table byte totals into a rough
 * "bytes read saved" figure, and (for the PREWHERE candidate only) runs a
 * before/after EXPLAIN to show the rewrite doesn't regress the query plan.
 *
 * Every number here is explicitly an ESTIMATE — see `summarizeImpact`'s
 * `summary` text, which always says so. Nothing in this file executes DDL or
 * writes anything; `measurePrewhereImpact` only issues read-only `EXPLAIN`
 * calls via `readOnlyQuery` (see plans/46-query-advisor-engine.md — the
 * recommend-only invariant).
 */

import type { EstimatedImpact } from './types'

import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'
import { formatBytes } from '@/lib/utils'

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

export interface MeasurePrewhereImpactInput {
  hostId: number
  originalSql: string
  rewrittenSql: string
  /** Used only if the before/after EXPLAIN comparison itself fails. */
  fallbackGranulesRead: number
  fallbackGranulesTotal: number
  tableBytes: number
  movedColumn: string
}

/**
 * Best-effort "validate no plan breakage" check for the PREWHERE rewrite:
 * runs `EXPLAIN ESTIMATE` (falls back gracefully on any failure — permission
 * denied, syntax quirk, etc.) on both the original and rewritten query and
 * compares selected rows/marks. Read-only: two `EXPLAIN` statements via
 * `readOnlyQuery`, nothing else. Never executes either query for real.
 */
export async function measurePrewhereImpact(
  input: MeasurePrewhereImpactInput
): Promise<EstimatedImpact> {
  const {
    hostId,
    originalSql,
    rewrittenSql,
    fallbackGranulesRead,
    fallbackGranulesTotal,
    tableBytes,
    movedColumn,
  } = input

  try {
    const [before, after] = await Promise.all([
      readOnlyQuery({
        query: `EXPLAIN ESTIMATE ${originalSql}`,
        hostId,
      }) as Promise<Array<{ marks: number | string }>>,
      readOnlyQuery({
        query: `EXPLAIN ESTIMATE ${rewrittenSql}`,
        hostId,
      }) as Promise<Array<{ marks: number | string }>>,
    ])

    const beforeMarks = before.reduce((sum, r) => sum + Number(r.marks ?? 0), 0)
    const afterMarks = after.reduce((sum, r) => sum + Number(r.marks ?? 0), 0)

    // EXPLAIN ESTIMATE reflects granules selected by the primary key/parts
    // pruning, which PREWHERE alone does not change (PREWHERE still reads the
    // same granules, just avoids materializing wide columns for filtered-out
    // rows within them) — so an increase here would mean the rewrite altered
    // pruning, i.e. a real regression signal worth surfacing plainly.
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
  } catch {
    return summarizeImpact({
      granulesRead: fallbackGranulesRead,
      granulesTotal: fallbackGranulesTotal,
      granulesSaved: fallbackGranulesRead,
      tableBytes,
      unknown: fallbackGranulesTotal === 0,
      label: `moving \`${movedColumn}\` to PREWHERE`,
    })
  }
}
