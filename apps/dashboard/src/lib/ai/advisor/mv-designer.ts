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
 */

import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'
import {
  extractReferencedTables,
  formatQualifiedTable,
  quoteIdentifier,
} from '@/lib/ai/agent/tools/sql-analysis'
import { formatBytes } from '@/lib/utils'

/** History window used to mine aggregation shapes when the caller doesn't specify one. */
const DEFAULT_WINDOW_HOURS = 24 * 7
/** How many top-cost query shapes to mine before per-shape filtering. */
const DEFAULT_TOP_N = 20
/** Row cap for the cardinality sample query — bounded so mining never triggers a full-table scan. */
const CARDINALITY_SAMPLE_SIZE = 100_000

const QUERY_LOG_UNAVAILABLE_MESSAGE =
  'system.query_log is not accessible on this host (disabled, or this ClickHouse user lacks the grant). The MV/projection designer needs it to mine aggregation shapes — refusing to fabricate recommendations without it.'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DesignKind = 'projection' | 'summing_mv' | 'aggregating_mv'

export interface AggregateCall {
  func: string
  arg: string
}

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
// Pure math / string building — no I/O, fully unit-testable.
// ---------------------------------------------------------------------------

/** ClickHouse aggregate functions whose merge semantics are a plain sum (safe for SummingMergeTree). Everything else needs `-State`/`-Merge` (AggregatingMergeTree). */
const SUM_COMPATIBLE_FUNCTIONS = new Set(['sum', 'count'])

const AGGREGATE_FUNCTION_NAMES = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'uniq',
  'uniqCombined',
  'uniqCombined64',
  'uniqExact',
  'uniqHLL12',
  'quantile',
  'quantiles',
  'quantileExact',
  'median',
  'groupArray',
  'groupUniqArray',
  'argMin',
  'argMax',
  'any',
  'anyLast',
  'topK',
  'stddevPop',
  'stddevSamp',
  'varPop',
  'varSamp',
]

// Note: parametric two-arg-list functions (`quantile(0.95)(col)`) are not
// fully parsed — the first parenthesized group is captured as `arg`, which
// for these is the level, not the column. This still classifies correctly
// as "mixed" (quantile is never sum-compatible), but the generated DDL's
// select expression for such a call carries a caveat rather than silently
// guessing the column; see `aggSelectExpr`.
const AGGREGATE_CALL_PATTERN = new RegExp(
  `\\b(${AGGREGATE_FUNCTION_NAMES.join('|')})\\s*\\(([^()]*)\\)`,
  'gi'
)

const GROUP_BY_CLAUSE_PATTERN =
  /\bGROUP\s+BY\b([\s\S]*?)(?:\bORDER\s+BY\b|\bHAVING\b|\bLIMIT\b|\bSETTINGS\b|\bFORMAT\b|$)/i

/**
 * Split a comma-separated expression list at the top level only — commas
 * nested inside function-call parens (`toDate(event_time), user_id`) are not
 * split points.
 */
export function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of input) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/**
 * Extract the GROUP BY key expressions from a query's text. Returns `[]` for
 * queries with no GROUP BY, or exotic forms (`GROUP BY ALL`, `GROUPING SETS`,
 * `ROLLUP`, `CUBE`) that this v1 doesn't model.
 */
export function extractGroupByKeys(sql: string): string[] {
  const match = sql.match(GROUP_BY_CLAUSE_PATTERN)
  if (!match) return []
  const clause = match[1].trim()
  if (!clause || /^(ALL\b|GROUPING SETS|ROLLUP|CUBE)/i.test(clause)) return []
  return splitTopLevelCommas(clause)
}

/** Extract aggregate function calls (`sum(x)`, `count()`, `uniq(y)`, …) from a query's text. */
export function extractAggregateCalls(sql: string): AggregateCall[] {
  const calls: AggregateCall[] = []
  for (const match of sql.matchAll(AGGREGATE_CALL_PATTERN)) {
    calls.push({ func: match[1].toLowerCase(), arg: match[2].trim() })
  }
  return calls
}

function normalizeKey(key: string): string {
  return key.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * True when `groupByKeys` (order-insensitive, as a set) equals the first
 * `groupByKeys.length` columns of `sortingKeyCols` — i.e. the aggregation can
 * ride the table's existing part ordering, the precondition for preferring a
 * projection over a second MV table.
 */
export function groupByMatchesSortingPrefix(
  groupByKeys: string[],
  sortingKeyCols: string[]
): boolean {
  if (groupByKeys.length === 0) return false
  if (sortingKeyCols.length < groupByKeys.length) return false
  const prefix = new Set(
    sortingKeyCols.slice(0, groupByKeys.length).map(normalizeKey)
  )
  return groupByKeys.every((k) => prefix.has(normalizeKey(k)))
}

export interface DesignInput {
  tableCount: number
  groupByKeys: string[]
  sortingKeyCols: string[]
  aggregateCalls: AggregateCall[]
}

export interface Design {
  kind: DesignKind
  rationale: string
}

/**
 * Choose projection vs. Summing/Aggregating MV for one mined shape.
 *
 * Tie-breaker (resolves the plan's "MV vs projection default" open
 * question, per the plan's own approach section): a single-table shape whose
 * GROUP BY keys match a prefix of the table's existing ORDER BY prefers a
 * PROJECTION — no second table, and ClickHouse re-aggregates it on merge
 * without needing `-State`/`-Merge`. This check runs *before* the
 * Summing/Aggregating choice, so it can win even for a sum/count-only shape
 * (a projection handles those fine too). Only when a projection isn't
 * eligible (multi-table, or GROUP BY doesn't match the sort prefix) do we
 * fall back to choosing between SummingMergeTree (sum/count only) and
 * AggregatingMergeTree (anything else) for a standalone MV.
 *
 * "Read-mostly" isn't independently verified (that would need a
 * `system.part_log` write-rate query on top of the ones this already does) —
 * the rationale states it as a labeled assumption instead of hiding it.
 */
export function chooseDesign(input: DesignInput): Design {
  const { tableCount, groupByKeys, sortingKeyCols, aggregateCalls } = input

  if (
    tableCount === 1 &&
    groupByMatchesSortingPrefix(groupByKeys, sortingKeyCols)
  ) {
    return {
      kind: 'projection',
      rationale: `Single-table aggregation whose GROUP BY keys (${groupByKeys.join(', ')}) match a prefix of the table's existing ORDER BY (${sortingKeyCols.slice(0, groupByKeys.length).join(', ')}) — a PROJECTION serves this without a second table and ClickHouse re-aggregates it on merge automatically (no -State/-Merge needed). Assumes the table is read-mostly; if it has heavy concurrent inserts, verify the projection's merge-time rebuild cost before applying.`,
    }
  }

  const funcs = aggregateCalls.map((c) => c.func.toLowerCase())
  const sumCountOnly =
    funcs.length > 0 && funcs.every((f) => SUM_COMPATIBLE_FUNCTIONS.has(f))

  if (sumCountOnly) {
    return {
      kind: 'summing_mv',
      rationale:
        'Aggregation uses only sum/count — a SummingMergeTree materialized view pre-aggregates these on merge without needing AggregateFunction state columns.',
    }
  }

  const distinctFuncs = [...new Set(funcs)]
  return {
    kind: 'aggregating_mv',
    rationale: `Aggregation includes non-summable functions (${distinctFuncs.join(', ')}) — an AggregatingMergeTree materialized view with -State columns is required; queries against it must use the matching -Merge combinators (e.g. ${distinctFuncs.map((f) => `${f}Merge`).join(', ')}).`,
  }
}

function normalizeForAlias(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function aggAlias(call: AggregateCall): string {
  const argPart = call.arg ? normalizeForAlias(call.arg) : ''
  return argPart ? `${call.func}_${argPart}` : call.func
}

/** Looks like a bare numeric literal (a parametric-function level, e.g. `quantile`'s `0.95`) rather than a column/expression. */
function looksLikeBareNumber(arg: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(arg.trim())
}

function aggSelectExpr(call: AggregateCall, mode: 'plain' | 'state'): string {
  const alias = aggAlias(call)
  if (call.func === 'count' && !call.arg) {
    return mode === 'state' ? `countState() AS ${alias}` : `count() AS ${alias}`
  }
  const callName = mode === 'state' ? `${call.func}State` : call.func
  const argComment = looksLikeBareNumber(call.arg)
    ? ' /* verify column: parsed as a parametric-function level, not a column */'
    : ''
  return `${callName}(${call.arg}) AS ${alias}${argComment}`
}

function ddlObjectName(table: string, groupByKeys: string[], suffix: string) {
  const keys = groupByKeys.map(normalizeForAlias).filter(Boolean).join('_')
  return normalizeForAlias(`${table}_by_${keys}_${suffix}`)
}

/**
 * Build the DDL text for a design decision. Pure string building — the
 * result is returned as data, never passed to a query-execution call.
 */
export function buildDdl(input: {
  design: Design
  database: string
  table: string
  groupByKeys: string[]
  aggregateCalls: AggregateCall[]
}): string {
  const { design, database, table, groupByKeys, aggregateCalls } = input
  const fullTable = formatQualifiedTable(database, table)
  const groupByList = groupByKeys.join(', ')

  if (design.kind === 'projection') {
    const projName = quoteIdentifier(ddlObjectName(table, groupByKeys, 'proj'))
    const selectCols = [
      ...groupByKeys,
      ...aggregateCalls.map((c) => aggSelectExpr(c, 'plain')),
    ]
    return `ALTER TABLE ${fullTable} ADD PROJECTION ${projName} (\n    SELECT\n        ${selectCols.join(',\n        ')}\n    GROUP BY ${groupByList}\n)`
  }

  const engine =
    design.kind === 'summing_mv' ? 'SummingMergeTree' : 'AggregatingMergeTree'
  const mode = design.kind === 'summing_mv' ? 'plain' : 'state'
  const target = formatQualifiedTable(
    database,
    ddlObjectName(table, groupByKeys, 'mv')
  )
  const selectCols = [
    ...groupByKeys,
    ...aggregateCalls.map((c) => aggSelectExpr(c, mode)),
  ]
  return `CREATE MATERIALIZED VIEW ${target}\nENGINE = ${engine}()\nORDER BY (${groupByList})\nAS SELECT\n    ${selectCols.join(',\n    ')}\nFROM ${fullTable}\nGROUP BY ${groupByList}`
}

/**
 * Risk note — always states the write-path/storage trade-off (never hidden),
 * plus the engine-specific caveat (`-State`/`-Merge` for Aggregating,
 * rebuild-on-ALTER for projections).
 */
export function buildRiskNote(kind: DesignKind): string {
  const common =
    "Adding this pre-aggregation adds write-path cost (every insert into the source table also updates this structure) and additional storage — it does not shrink the source table, and it does not change any existing query's plan."
  if (kind === 'projection') {
    return `${common} Projections rebuild as part of the base table's own merges; new projections only cover rows inserted after creation until you run \`ALTER TABLE ... MATERIALIZE PROJECTION\`, which rewrites existing parts — a heavy one-time I/O cost on a large table.`
  }
  if (kind === 'aggregating_mv') {
    return `${common} This is a separate table driven by a trigger on every INSERT into the source table. AggregatingMergeTree requires querying it with \`-Merge\` combinators (e.g. \`sumMerge\`, \`avgMerge\`, \`uniqMerge\`) matching the \`-State\` columns used to populate it — plain aggregate functions will not read the raw state columns correctly.`
  }
  return `${common} This is a separate table driven by a trigger on every INSERT into the source table. SummingMergeTree only finalizes sums across merged parts — query it with \`GROUP BY\`/\`sum()\` (not a raw row read), since unmerged parts can still hold multiple partial rows per key.`
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

// ---------------------------------------------------------------------------
// Orchestration — ClickHouse-backed. Thin wrappers around the pure logic
// above; every query is read-only (`readOnlyQuery` sets `readonly: '1'`).
// ---------------------------------------------------------------------------

interface MinedShape {
  hash: string
  calls: number
  totalReadBytes: number
  sampleQuery: string
  tableCount: number
  database: string
  table: string
  groupByKeys: string[]
  aggregateCalls: AggregateCall[]
}

async function mineAggregationShapes(
  hostId: number,
  windowHours: number,
  topN: number
): Promise<MinedShape[]> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT normalized_query_hash AS hash, count() AS calls, sum(read_bytes) AS total_read_bytes, any(query) AS sample_query ' +
      'FROM system.query_log ' +
      "WHERE type = 'QueryFinish' AND is_initial_query = 1 " +
      'AND event_time >= now() - INTERVAL {windowHours:UInt32} HOUR ' +
      "AND positionCaseInsensitive(query, 'GROUP BY') > 0 " +
      'GROUP BY hash ORDER BY total_read_bytes DESC LIMIT {topN:UInt32} ' +
      'SETTINGS max_execution_time = 25',
    query_params: { windowHours, topN },
    hostId,
  })) as Array<{
    hash: string
    calls: string | number
    total_read_bytes: string | number
    sample_query: string
  }>

  const shapes: MinedShape[] = []
  for (const row of rows) {
    const sql = row.sample_query
    const groupByKeys = extractGroupByKeys(sql)
    const aggregateCalls = extractAggregateCalls(sql)
    if (groupByKeys.length === 0 || aggregateCalls.length === 0) continue

    const tables = extractReferencedTables(sql)
    if (tables.length === 0) continue

    shapes.push({
      hash: row.hash,
      calls: Number(row.calls),
      totalReadBytes: Number(row.total_read_bytes),
      sampleQuery: sql,
      tableCount: tables.length,
      database: tables[0].database,
      table: tables[0].table,
      groupByKeys,
      aggregateCalls,
    })
  }
  return shapes
}

async function getTableSizeStats(
  hostId: number,
  database: string,
  table: string
): Promise<{ rows: number; bytesOnDisk: number }> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT sum(rows) AS rows, sum(bytes_on_disk) AS bytes_on_disk FROM system.parts ' +
      'WHERE active = 1 AND database = {database:String} AND table = {table:String} ' +
      'SETTINGS max_execution_time = 25',
    query_params: { database, table },
    hostId,
  })) as Array<{ rows: string | number; bytes_on_disk: string | number }>

  return {
    rows: Number(rows[0]?.rows ?? 0),
    bytesOnDisk: Number(rows[0]?.bytes_on_disk ?? 0),
  }
}

/** Ordered sorting-key column/expression list, derived from `system.tables.sorting_key` (a comma-joined expression string). */
async function getSortingKeyColumns(
  hostId: number,
  database: string,
  table: string
): Promise<string[]> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
    query_params: { database, table },
    hostId,
  })) as Array<{ sorting_key: string }>

  const sortingKey = rows[0]?.sorting_key ?? ''
  if (!sortingKey.trim()) return []
  return splitTopLevelCommas(sortingKey)
}

/**
 * Cheap, bounded cardinality estimate for the GROUP BY key combination —
 * `uniqCombined` over a row-capped sample (never a full-table scan), scaled
 * up to the table's full row count. This resolves the plan's "cardinality
 * source" open question: a LIMIT-bounded sample is available on every
 * MergeTree table (unlike `SAMPLE n`, which needs a declared sampling key).
 */
async function estimateGroupCardinality(
  hostId: number,
  database: string,
  table: string,
  groupByKeys: string[],
  sourceRows: number
): Promise<number> {
  const sampleSize = Math.min(CARDINALITY_SAMPLE_SIZE, sourceRows)
  if (sampleSize <= 0) return 0

  const fullTable = formatQualifiedTable(database, table)
  const cols = groupByKeys.join(', ')
  const rows = (await readOnlyQuery({
    query:
      `SELECT uniqCombined(${cols}) AS distinct_combos FROM ` +
      `(SELECT ${cols} FROM ${fullTable} LIMIT {sampleSize:UInt32}) ` +
      'SETTINGS max_execution_time = 25',
    query_params: { sampleSize },
    hostId,
  })) as Array<{ distinct_combos: string | number }>

  const sampleDistinct = Number(rows[0]?.distinct_combos ?? 0)
  return scaleCardinality(sampleDistinct, sampleSize, sourceRows)
}

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

  const recommendations: MvRecommendation[] = []

  for (const shape of shapes) {
    // Multi-table (JOIN) aggregation shapes are out of scope for v1 — an MV
    // can only trigger cleanly off one source table. Still counted in
    // shapesAnalyzed below (a real aggregation shape that didn't get a
    // recommendation), not silently dropped from the coverage accounting.
    if (shape.tableCount > 1) continue

    try {
      const [sizeStats, sortingKeyCols] = await Promise.all([
        getTableSizeStats(hostId, shape.database, shape.table),
        getSortingKeyColumns(hostId, shape.database, shape.table),
      ])
      if (sizeStats.rows === 0) continue

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

      recommendations.push({
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
      })
    } catch {
      // Best-effort: a permission-denied/missing table for this one shape
      // must not sink the whole batch — skip and continue with the rest.
    }
  }

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

export { DEFAULT_WINDOW_HOURS, DEFAULT_TOP_N, CARDINALITY_SAMPLE_SIZE }
