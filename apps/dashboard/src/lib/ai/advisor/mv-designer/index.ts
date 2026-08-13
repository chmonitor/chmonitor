/**
 * MV / projection designer.
 *
 * Mines the top aggregation shapes (frequent `GROUP BY` + aggregate
 * functions) from `system.query_log`, proposes a Summing/Aggregating
 * MergeTree materialized view — or a projection when the shape can ride the
 * base table's existing ORDER BY — and estimates the resulting size from
 * `system.parts` × a sampled aggregation ratio.
 *
 * **Recommend-only, absolutely.** This module has no apply/execute surface:
 * every public entry point below either does read-only queries (via
 * `readOnlyQuery`, which sets `readonly: '1'`) or is pure math/string
 * building. The generated DDL is returned as an inert string on the
 * recommendation object — nothing here ever sends `CREATE MATERIALIZED VIEW`
 * or `ALTER TABLE ... ADD PROJECTION` to ClickHouse. See
 * plans/47-mv-projection-designer.md.
 *
 * Mirrors `capacity-forecaster.ts`'s shape: pure, fully-unit-testable math
 * (engine choice, size estimate, DDL text) plus thin ClickHouse-backed
 * orchestration wrappers. Intentionally self-contained — plan 46
 * (query-advisor-engine) is being built in parallel and may not be merged;
 * this file does not import from it. Field names (`kind`, `ddl`, `rationale`,
 * `risk`) loosely mirror plan 46's `Recommendation` shape so a future merge
 * can reconcile the two, but nothing here depends on that file existing.
 *
 * This module carries the shared types + the `designMaterializedViews`
 * orchestrator; the implementation is split across cohesive siblings so each
 * stays readable and independently testable:
 *
 *  - `sql-parsing.ts` — extract GROUP BY keys / aggregate calls from SQL text.
 *  - `design-selection.ts` — `chooseDesign`: projection vs. Summing/Aggregating MV.
 *  - `ddl.ts` — DDL text + risk-note building.
 *  - `size-estimator.ts` — size + impact estimation math.
 *  - `shape-mining.ts` — ClickHouse-backed mining (query_log, parts, sorting key, cardinality sample).
 *
 * This file re-exports everything from the five so no import site needs to
 * change: `import { ... } from '@/lib/ai/advisor/mv-designer'` keeps working
 * exactly as before.
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

/** History window used to mine aggregation shapes when the caller doesn't specify one. */
export const DEFAULT_WINDOW_HOURS = 24 * 7
/** How many top-cost query shapes to mine before per-shape filtering. */
export const DEFAULT_TOP_N = 20
/** Max candidate shapes processed concurrently — bounds ClickHouse connection fan-out per request. */
const SHAPE_CONCURRENCY = 5

/**
 * Run `fn` over `items` with at most `concurrency` in flight at once,
 * returning results in the same order as `items`. A rejected `fn` call
 * resolves to `undefined` at that index rather than rejecting the whole
 * batch — callers that need per-item error handling should catch inside
 * `fn` itself; this is just a safety net so one throw can't sink the batch.
 */
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

// ---------------------------------------------------------------------------
// Types
//
// `AggregateCall` lives in `./sql-parsing` (where it's first produced),
// `DesignKind`/`Design`/`DesignInput` in `./design-selection`, and
// `SizeEstimate`/`ImpactEstimate`/`SizeEstimateInput` in `./size-estimator` —
// each owned by the module that defines it, so the sibling modules never need
// to import back from this orchestrator file (which would create a circular
// dependency, since this file already imports their functions). All of them
// are re-exported below via `export * from './<sibling>'`, so the full type
// surface is still available from `@/lib/ai/advisor/mv-designer` exactly as
// before. Only the result-level types below — used solely by this file's own
// orchestrator — are declared here.
// ---------------------------------------------------------------------------

export interface MvRecommendation {
  kind: DesignKind
  table: string
  groupByKeys: string[]
  aggregateFunctions: string[]
  /** DDL text only — never executed by this module. */
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

// ---------------------------------------------------------------------------
// Orchestration — ClickHouse-backed. Thin wrappers around the pure logic in
// the sibling modules; every query is read-only (`readOnlyQuery` sets
// `readonly: '1'`).
// ---------------------------------------------------------------------------

/**
 * Mine frequent aggregation shapes from `system.query_log` and design a
 * ranked MV/projection recommendation for each — DDL + size estimate +
 * impact + risk, never applied. Returns `available: false` (never a
 * fabricated recommendation) if `system.query_log` can't be read at all.
 * Per-shape failures (e.g. no grant on `system.parts` for one table) are
 * skipped individually rather than sinking the whole batch — mirrors
 * `capacity-forecaster.ts`'s best-effort enrichment pattern.
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

  // Multi-table (JOIN) aggregation shapes are out of scope for v1 — an MV can
  // only trigger cleanly off one source table. Still counted in
  // shapesAnalyzed below (a real aggregation shape that didn't get a
  // recommendation), not silently dropped from the coverage accounting.
  const eligibleShapes = shapes.filter((s) => s.tableCount <= 1)

  // Process candidate shapes with bounded concurrency instead of one at a
  // time — each shape does several independent ClickHouse round-trips
  // (size stats, sorting key, cardinality sample), so serial processing of
  // up to `topN` shapes was the dominant cost. mapWithConcurrency preserves
  // input order and a per-shape failure (e.g. permission-denied on
  // system.parts for one table) resolves to `undefined` there rather than
  // sinking the whole batch.
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
