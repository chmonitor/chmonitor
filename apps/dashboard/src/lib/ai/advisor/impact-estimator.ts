/**
 * Query advisor — impact estimation (app side). The estimate math lives in
 * `@chm/query-advisor-core`; only the ClickHouse-bound before/after
 * `EXPLAIN ESTIMATE` for the PREWHERE candidate stays here. Read-only: see the
 * recommend-only invariant in `recommendation-engine.ts`.
 */

import type { EstimatedImpact } from './types'

import {
  prewhereFallbackImpact,
  sumEstimateMarks,
  summarizePrewhereMarks,
} from '@chm/query-advisor-core'
import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'

export {
  estimateBytesSaved,
  type SummarizeImpactInput,
  summarizeImpact,
} from '@chm/query-advisor-core'

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
 * Best-effort PREWHERE plan-breakage check: runs `EXPLAIN ESTIMATE` on the
 * original and rewritten query and compares selected rows/marks. Falls back
 * gracefully on any failure (permission denied, syntax quirk). Read-only.
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

    return summarizePrewhereMarks({
      beforeMarks: sumEstimateMarks(before),
      afterMarks: sumEstimateMarks(after),
      movedColumn,
    })
  } catch {
    return prewhereFallbackImpact({
      fallbackGranulesRead,
      fallbackGranulesTotal,
      tableBytes,
      movedColumn,
    })
  }
}
