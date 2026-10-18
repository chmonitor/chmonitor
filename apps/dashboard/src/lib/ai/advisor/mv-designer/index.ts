/**
 * MV / projection designer: mines top aggregation shapes from
 * `system.query_log`, proposes a Summing/Aggregating MV (or a projection when
 * the shape can ride the base table's ORDER BY), and estimates size from
 * `system.parts` x a sampled aggregation ratio.
 *
 * **Recommend-only, absolutely.** Entry points either run read-only queries
 * (via `readOnlyQuery`, `readonly: '1'`) or are pure; generated DDL is an inert
 * string and nothing here ever sends `CREATE MATERIALIZED VIEW` or `ALTER TABLE
 * ... ADD PROJECTION` to ClickHouse.
 *
 * Siblings: `sql-parsing.ts`, `design-selection.ts`, `ddl.ts`,
 * `size-estimator.ts`, `shape-mining.ts`; all re-exported from here.
 */

import type { DesignKind } from './design-selection'
import type { MinedShape } from './shape-mining'
import type { ImpactEstimate, SizeEstimate } from './size-estimator'

import { buildDdl, buildRiskNote } from './ddl'
import { chooseDesign } from './design-selection'
import {
  estimateGroupCardinality,
  getSortingKeyColumns,
  getTableSizeStats,
  mineAggregationShapes,
} from './shape-mining'
import { estimateImpact, estimateMvSize } from './size-estimator'
import { formatQualifiedTable } from '@/lib/ai/agent/tools/sql-analysis'

export const DEFAULT_WINDOW_HOURS = 24 * 7
export const DEFAULT_TOP_N = 20
const SHAPE_CONCURRENCY = 5

/** Results keep input order; a rejected `fn` resolves to `undefined` at that index so one throw can't sink the batch. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      try {
        results[index] = await fn(items[index], index)
      } catch {
        results[index] = undefined
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  )
  return results
}

const QUERY_LOG_UNAVAILABLE_MESSAGE =
  'system.query_log is not accessible on this host (disabled, or this ClickHouse user lacks the grant). The MV/projection designer needs it to mine aggregation shapes — refusing to fabricate recommendations without it.'

// `AggregateCall`, `DesignKind`/`Design`/`DesignInput` and
// `SizeEstimate`/`ImpactEstimate`/`SizeEstimateInput` live in their sibling
// modules (re-exported below) so siblings never import back from this file,
// which would create a cycle.

export interface MvRecommendation {
  kind: DesignKind
  table: string
  groupByKeys: string[]
  aggregateFunctions: string[]
  ddl: string
  rationale: string
  risk: string
  sizeEstimate: SizeEstimate
  impact: ImpactEstimate
  sampleQuery: string
}

export interface MvDesignerUnavailable {
  available: false
  reason: 'query_log_unavailable'
  message: string
}

export interface MvDesignerResult {
  available: true
  windowHours: number
  shapesAnalyzed: number
  shapesWithRecommendation: number
  coverageRatio: number
  recommendations: MvRecommendation[]
}

export type DesignResult = MvDesignerUnavailable | MvDesignerResult

/**
 * Returns `available: false` (never a fabricated recommendation) if
 * `system.query_log` can't be read. Per-shape failures (e.g. no grant on
 * `system.parts`) are skipped individually rather than sinking the batch.
 */
export async function designMaterializedViews(params: {
  hostId: number
  table?: string
  windowHours?: number
  topN?: number
}): Promise<DesignResult> {
  const {
    hostId,
    table: tableFilter,
    windowHours = DEFAULT_WINDOW_HOURS,
    topN = DEFAULT_TOP_N,
  } = params

  let shapes: MinedShape[]
  try {
    shapes = await mineAggregationShapes(hostId, windowHours, topN)
  } catch {
    return {
      available: false,
      reason: 'query_log_unavailable',
      message: QUERY_LOG_UNAVAILABLE_MESSAGE,
    }
  }

  if (tableFilter) {
    const normalized = tableFilter.trim().toLowerCase().replace(/`/g, '')
    shapes = shapes.filter(
      (s) =>
        `${s.database}.${s.table}`.toLowerCase() === normalized ||
        s.table.toLowerCase() === normalized
    )
  }

  // Multi-table (JOIN) shapes are out of scope: an MV can only trigger off one
  // source table. Still counted in shapesAnalyzed.
  const eligibleShapes = shapes.filter((s) => s.tableCount <= 1)

  // Bounded concurrency: each shape does several independent round-trips, so
  // serial processing of `topN` shapes dominated cost.
  const perShapeResults = await mapWithConcurrency(
    eligibleShapes,
    SHAPE_CONCURRENCY,
    async (shape): Promise<MvRecommendation | undefined> => {
      const [sizeStats, sortingKeyCols] = await Promise.all([
        getTableSizeStats(hostId, shape.database, shape.table),
        getSortingKeyColumns(hostId, shape.database, shape.table),
      ])
      if (sizeStats.rows === 0) return undefined

      const distinctCombinations = await estimateGroupCardinality(
        hostId,
        shape.database,
        shape.table,
        shape.groupByKeys,
        sizeStats.rows
      )

      const design = chooseDesign({
        tableCount: shape.tableCount,
        groupByKeys: shape.groupByKeys,
        sortingKeyCols,
        aggregateCalls: shape.aggregateCalls,
      })

      const sizeEstimate = estimateMvSize({
        sourceRows: sizeStats.rows,
        sourceBytes: sizeStats.bytesOnDisk,
        distinctCombinations,
      })

      const ddl = buildDdl({
        design,
        database: shape.database,
        table: shape.table,
        groupByKeys: shape.groupByKeys,
        aggregateCalls: shape.aggregateCalls,
      })

      const impact = estimateImpact({
        callsInWindow: shape.calls,
        totalReadBytes: shape.totalReadBytes,
        mvEstimatedBytes: sizeEstimate.estimatedBytes,
      })

      return {
        kind: design.kind,
        table: formatQualifiedTable(shape.database, shape.table),
        groupByKeys: shape.groupByKeys,
        aggregateFunctions: shape.aggregateCalls.map((c) => c.func),
        ddl,
        rationale: design.rationale,
        risk: buildRiskNote(design.kind),
        sizeEstimate,
        impact,
        sampleQuery: shape.sampleQuery,
      }
    }
  )

  const recommendations: MvRecommendation[] = perShapeResults.filter(
    (r): r is MvRecommendation => r !== undefined
  )

  const shapesAnalyzed = shapes.length
  const shapesWithRecommendation = recommendations.length

  return {
    available: true,
    windowHours,
    shapesAnalyzed,
    shapesWithRecommendation,
    coverageRatio:
      shapesAnalyzed > 0 ? shapesWithRecommendation / shapesAnalyzed : 0,
    recommendations: recommendations.sort(
      (a, b) =>
        b.impact.estimatedBytesSavedTotal - a.impact.estimatedBytesSavedTotal
    ),
  }
}

export * from './ddl'
export * from './design-selection'
export * from './shape-mining'
export * from './size-estimator'
export * from './sql-parsing'
