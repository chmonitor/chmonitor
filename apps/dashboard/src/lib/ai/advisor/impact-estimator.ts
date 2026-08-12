/**
 * Query advisor — impact estimation (app side).
 *
 * The estimate math itself (`estimateBytesSaved`, `summarizeImpact`, and the
 * PREWHERE before/after verdict) lives in `@chm/query-advisor-core`, shared
 * with the MCP advisor tool so both surfaces phrase the same estimate the same
 * way (issue #2936). What stays here is the one piece that needs a ClickHouse
 * connection: running the before/after `EXPLAIN ESTIMATE` for the PREWHERE
 * candidate.
 *
 * Every number is explicitly an ESTIMATE — see `summarizeImpact`'s `summary`
 * text, which always says so. Nothing in this file executes DDL or writes
 * anything; `measurePrewhereImpact` only issues read-only `EXPLAIN` calls via
 * `readOnlyQuery` (see plans/46-query-advisor-engine.md — the recommend-only
 * invariant).
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
  summarizeImpact,
  type SummarizeImpactInput,
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
