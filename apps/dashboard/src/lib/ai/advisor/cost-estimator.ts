/**
 * Query cost estimator — EXPLAIN → rows / bytes / memory / time estimate.
 *
 * Runs `EXPLAIN json = 1, header = 1, indexes = 1 <sql>` against ClickHouse
 * and turns the structured plan into a rough pre-flight cost estimate: rows
 * scanned, bytes read, peak memory, and wall time. It powers runaway-query
 * guardrails and (later) plan 46's DDL-recommendation impact math.
 *
 * READ-ONLY / never-execute invariant: `sql` is validated (SELECT/WITH/
 * DESCRIBE-shaped, single statement — see `validateAgentSql`) and then only
 * ever sent wrapped inside an `EXPLAIN` statement via `readOnlyQuery`
 * (readonly transport). The analyzed query is never executed or mutated —
 * see cost-estimator.test.ts's "never executes/mutates" assertions.
 *
 * JSON shape grounded in ClickHouse's own test fixtures (verified against
 * tests/queries/0_stateless/01786_explain_merge_tree.reference and
 * 01823_explain_json.reference in github.com/ClickHouse/ClickHouse), not
 * guessed:
 *   [{ "Plan": { "Node Type", "Node Id"?, "Plans"?: [...], "Description"?,
 *                "Header"?: [{"Name","Type"}], "Indexes"?: [...], "Keys"?: [...] } }]
 * `EXPLAIN`'s `json`/`header`/`indexes` settings have been stable since
 * ClickHouse ~20.6–21.3, well below this project's v23.1 support floor
 * (docs/clickhouse-schemas) — resolved: no per-version (`since`) gating is
 * needed for the EXPLAIN query text itself.
 *
 * Throughput hint (open question, resolved): a static, documented default,
 * overridable via `throughputHint`. A per-host `system.query_log`-derived
 * hint was considered and rejected for now — it would add another query (and
 * query-load surface) to every estimate call for a refinement that doesn't
 * change the tool's correctness, only its precision; revisit if real usage
 * shows the static default is materially off.
 */

import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'
import { validateAgentSql } from '@/lib/ai/agent/tools/sql-analysis'

// ---------------------------------------------------------------------------
// Constants — documented, overridable heuristics. Every number this module
// produces is an ESTIMATE; nothing here is a precise cost model.
// ---------------------------------------------------------------------------

/** ClickHouse's default `index_granularity`: rows represented per granule. */
export const DEFAULT_GRANULE_ROWS = 8192

/** Used only when a table has no column-size stats at all (e.g. access denied). */
export const FALLBACK_AVG_ROW_SIZE_BYTES = 100

export interface ThroughputHint {
  bytesPerSec: number
  rowsPerSec: number
}

/**
 * Conservative default scan throughput used when no better hint is supplied.
 * Deliberately modest (not "best case on fast hardware"): this feeds a
 * runaway-query guardrail, so under-estimating danger is worse than over-
 * estimating query time.
 */
export const DEFAULT_THROUGHPUT_HINT: ThroughputHint = {
  bytesPerSec: 500_000_000, // 500 MB/s
  rowsPerSec: 100_000_000, // 100M rows/s
}

// ---------------------------------------------------------------------------
// Types — parsed EXPLAIN plan
// ---------------------------------------------------------------------------

export interface ExplainIndexInfo {
  type: string
  name?: string
  initialParts?: number
  selectedParts?: number
  initialGranules?: number
  selectedGranules?: number
}

export interface ExplainHeaderColumn {
  name: string
  type: string
}

export interface ExplainReadStep {
  /** `database.table` parsed from the node's Description, when present. */
  table: string | null
  indexes: ExplainIndexInfo[]
  header: ExplainHeaderColumn[]
}

export interface ParsedExplainPlan {
  reads: ExplainReadStep[]
  hasFilter: boolean
  hasJoin: boolean
  hasAggregation: boolean
  /** GROUP BY key column names, when an Aggregating node was found. */
  aggregationKeys: string[]
  /** Every Node Type encountered, in traversal order — for diagnostics. */
  nodeTypes: string[]
}

// ---------------------------------------------------------------------------
// parseExplainPlan — pure, no I/O. Tolerant of unknown/missing fields: a
// plan-shape surprise degrades to fewer signals (lower confidence) rather
// than throwing.
// ---------------------------------------------------------------------------

interface RawExplainIndex {
  Type?: string
  Name?: string
  'Initial Parts'?: number
  'Selected Parts'?: number
  'Initial Granules'?: number
  'Selected Granules'?: number
}

interface RawExplainHeaderCol {
  Name?: string
  Type?: string
}

interface RawExplainNode {
  'Node Type'?: string
  Plans?: RawExplainNode[]
  Description?: string
  Header?: RawExplainHeaderCol[]
  Indexes?: RawExplainIndex[]
  Keys?: string[]
}

/** `Description` is typically `database.table` (e.g. `"default.events"`). */
function extractTableName(description: string | undefined): string | null {
  if (!description) return null
  const match = description.match(/^[\w$]+(?:\.[\w$]+)?/)
  return match ? match[0] : description
}

function walk(node: RawExplainNode, plan: ParsedExplainPlan): void {
  const nodeType = node['Node Type']
  if (nodeType) plan.nodeTypes.push(nodeType)

  if (nodeType === 'ReadFromMergeTree') {
    const indexes: ExplainIndexInfo[] = (node.Indexes ?? []).map((idx) => ({
      type: idx.Type ?? 'Unknown',
      name: idx.Name,
      initialParts: idx['Initial Parts'],
      selectedParts: idx['Selected Parts'],
      initialGranules: idx['Initial Granules'],
      selectedGranules: idx['Selected Granules'],
    }))
    const header: ExplainHeaderColumn[] = (node.Header ?? [])
      .filter((h): h is { Name: string; Type?: string } => Boolean(h.Name))
      .map((h) => ({ name: h.Name, type: h.Type ?? '' }))
    plan.reads.push({
      table: extractTableName(node.Description),
      indexes,
      header,
    })
  }

  if (nodeType === 'Filter') plan.hasFilter = true
  // Case-insensitive substring match tolerates ClickHouse's various join step
  // names across versions/analyzer states (e.g. "Join", "JoinStep").
  if (nodeType && /join/i.test(nodeType)) plan.hasJoin = true
  if (nodeType === 'Aggregating') {
    plan.hasAggregation = true
    if (node.Keys) plan.aggregationKeys.push(...node.Keys)
  }

  for (const child of node.Plans ?? []) {
    walk(child, plan)
  }
}

/**
 * Parse already-`JSON.parse`d `EXPLAIN json = 1, header = 1, indexes = 1`
 * output into a flat summary of read/filter/join/aggregation steps.
 */
export function parseExplainPlan(explainJson: unknown): ParsedExplainPlan {
  const plan: ParsedExplainPlan = {
    reads: [],
    hasFilter: false,
    hasJoin: false,
    hasAggregation: false,
    aggregationKeys: [],
    nodeTypes: [],
  }

  if (!Array.isArray(explainJson)) return plan

  for (const entry of explainJson) {
    const root = (entry as { Plan?: RawExplainNode } | null | undefined)?.Plan
    if (root) walk(root, plan)
  }

  return plan
}

/**
 * `EXPLAIN` results come back as one row per output line (see
 * `readOnlyQuery`/`useExplain`) — join them back into the full JSON text
 * before parsing. Returns `null` (never throws) on malformed JSON so a
 * shape surprise degrades to a "low confidence, unknown estimate" result
 * instead of crashing the tool.
 */
export function parseExplainJsonRows(
  rows: Array<{ explain?: string }>
): unknown {
  const text = rows.map((r) => r.explain ?? '').join('\n')
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Column size stats — per referenced table, from system.columns + system.tables
// ---------------------------------------------------------------------------

export interface TableColumnStats {
  /** Current row count for the table (system.tables.total_rows). */
  totalRows: number | null
  /** Uncompressed bytes per column name (system.columns.data_uncompressed_bytes). */
  columnBytes: Map<string, number>
}

export type ColumnStatsByTable = Map<string, TableColumnStats>

/**
 * Per-column average row size, reusing the same `data_uncompressed_bytes /
 * rows` shape used elsewhere for column storage stats (see
 * lib/query-config/system/database-table.ts), adapted here to a single
 * lightweight query per referenced table (metadata-cached — see
 * `readOnlyQuery`'s `useCache`) instead of a UI QueryConfig.
 */
async function fetchColumnStats(
  hostId: number,
  tables: Array<{ database: string; table: string }>
): Promise<ColumnStatsByTable> {
  const stats: ColumnStatsByTable = new Map()

  const results = await Promise.all(
    tables.map(async ({ database, table }) => {
      const rows = (await readOnlyQuery({
        query: `
          SELECT
            c.name AS name,
            sum(c.data_uncompressed_bytes) AS uncompressed_bytes,
            any(t.total_rows) AS total_rows
          FROM system.columns c
          INNER JOIN system.tables t ON t.database = c.database AND t.name = c.table
          WHERE c.database = {database:String} AND c.table = {table:String}
          GROUP BY c.name
        `,
        query_params: { database, table },
        hostId,
        useCache: true,
      })) as Array<{
        name: string
        uncompressed_bytes: string | number
        total_rows: string | number | null
      }>
      return { key: `${database}.${table}`, rows }
    })
  )

  for (const { key, rows } of results) {
    if (rows.length === 0) continue
    const columnBytes = new Map<string, number>()
    let totalRows: number | null = null
    for (const row of rows) {
      columnBytes.set(row.name, Number(row.uncompressed_bytes))
      if (row.total_rows != null) totalRows = Number(row.total_rows)
    }
    stats.set(key, { totalRows, columnBytes })
  }

  return stats
}

// ---------------------------------------------------------------------------
// estimateRowsAndMemory — pure
// ---------------------------------------------------------------------------

export interface RowsAndMemoryEstimate {
  estRows: number
  estBytesRead: number
  estPeakMemoryBytes: number
  warnings: string[]
}

interface StepEstimate {
  rows: number
  bytes: number
  avgRowSize: number
}

function estimateReadStep(
  step: ExplainReadStep,
  columnStats: ColumnStatsByTable,
  warnings: string[]
): StepEstimate {
  const stats = step.table ? columnStats.get(step.table) : undefined
  const label = step.table ?? 'a table'

  // Rows: the LAST index entry is the most-pruned count — ClickHouse applies
  // MinMax -> Partition -> PrimaryKey -> Skip indexes in sequence, and each
  // subsequent "Selected Granules" is <= the previous one.
  let rows: number | null = null
  const withGranules = step.indexes.filter(
    (idx) => typeof idx.selectedGranules === 'number'
  )
  if (withGranules.length > 0) {
    rows =
      withGranules[withGranules.length - 1].selectedGranules! *
      DEFAULT_GRANULE_ROWS
  }
  if (rows === null) {
    if (stats?.totalRows != null) {
      rows = stats.totalRows
      warnings.push(
        `${label}: no index-pruning info in the plan — estimating rows from the table's total row count (full-scan assumption).`
      )
    } else {
      rows = 0
      warnings.push(
        `${label}: no index info and no row-count stats available — rows/bytes for this table are unknown (reported as 0).`
      )
    }
  }

  // Avg row size: sum of the columns actually read (plan Header) at their
  // per-row uncompressed size; falls back to all known columns, then to a
  // fixed default when no stats are available at all.
  let avgRowSize: number
  if (stats?.totalRows) {
    const columnsToSum =
      step.header.length > 0
        ? step.header.map((h) => h.name)
        : [...stats.columnBytes.keys()]
    const totalBytes = columnsToSum.reduce(
      (sum, col) => sum + (stats.columnBytes.get(col) ?? 0),
      0
    )
    avgRowSize = totalBytes / stats.totalRows
    if (avgRowSize <= 0) avgRowSize = FALLBACK_AVG_ROW_SIZE_BYTES
  } else {
    avgRowSize = FALLBACK_AVG_ROW_SIZE_BYTES
    warnings.push(
      `${label}: no column-size stats available — assuming ~${FALLBACK_AVG_ROW_SIZE_BYTES} bytes/row.`
    )
  }

  return { rows, bytes: rows * avgRowSize, avgRowSize }
}

/**
 * Propagate cardinalities from a parsed EXPLAIN plan into rows / bytes / peak
 * memory estimates.
 *
 * Peak memory follows `max(scan floor, join build side, aggregation state)`
 * rather than "all bytes read": ClickHouse streams a plain filtered scan in
 * granule-sized blocks, it does not materialize the whole scan in memory, so
 * a scan with neither JOIN nor GROUP BY has a small, bounded peak (one
 * granule's worth per read step). JOIN and aggregation are the two node
 * types that actually force materialization, so they are the only
 * memory-raising terms — matching how ClickHouse's own planner treats them.
 */
export function estimateRowsAndMemory(
  plan: ParsedExplainPlan,
  columnStats: ColumnStatsByTable
): RowsAndMemoryEstimate {
  const warnings: string[] = []

  if (plan.reads.length === 0) {
    warnings.push(
      'No ReadFromMergeTree step found in the plan — this query may not scan a MergeTree table, or the plan shape was not recognized. Rows/bytes/memory are unknown (reported as 0).'
    )
    return { estRows: 0, estBytesRead: 0, estPeakMemoryBytes: 0, warnings }
  }

  const stepEstimates = plan.reads.map((step) =>
    estimateReadStep(step, columnStats, warnings)
  )

  const estRows = stepEstimates.reduce((sum, s) => sum + s.rows, 0)
  const estBytesRead = stepEstimates.reduce((sum, s) => sum + s.bytes, 0)

  // Baseline: at least one granule's worth (per the widest read step) is
  // held in memory at a time even for a plain streaming scan.
  const scanFloorBytes = Math.max(
    ...stepEstimates.map((s) => DEFAULT_GRANULE_ROWS * s.avgRowSize)
  )

  let joinBuildSideBytes = 0
  if (plan.hasJoin && stepEstimates.length > 1) {
    joinBuildSideBytes = Math.min(...stepEstimates.map((s) => s.bytes))
    warnings.push(
      'Query has a JOIN — peak memory includes a rough build-side estimate (assumes the smallest scanned table is the hash build side, materialized in full).'
    )
  }

  let aggregationStateBytes = 0
  if (plan.hasAggregation) {
    // Worst-case proxy: without a cardinality estimate from EXPLAIN, assume
    // every input row could form its own group (state size approaches input
    // size). Actual memory is very likely lower when groups are few.
    aggregationStateBytes = estBytesRead
    warnings.push(
      'Query has an aggregation — peak memory assumes worst-case GROUP BY cardinality (EXPLAIN does not report output cardinality); actual memory is likely lower if there are few distinct groups.'
    )
  }

  const estPeakMemoryBytes = Math.max(
    scanFloorBytes,
    joinBuildSideBytes,
    aggregationStateBytes
  )

  return {
    estRows: Math.round(estRows),
    estBytesRead: Math.round(estBytesRead),
    estPeakMemoryBytes: Math.round(estPeakMemoryBytes),
    warnings,
  }
}

// ---------------------------------------------------------------------------
// estimateWallMs — pure
// ---------------------------------------------------------------------------

/**
 * Wall-time estimate: `bytes_read / bytes_per_sec + rows / rows_per_sec`.
 * Deliberately additive (not `max`) — a simple, conservative (over-)estimate
 * rather than a precise pipeline model.
 */
export function estimateWallMs(
  estimate: { estRows: number; estBytesRead: number },
  throughputHint: ThroughputHint = DEFAULT_THROUGHPUT_HINT
): number {
  const bytesMs = (estimate.estBytesRead / throughputHint.bytesPerSec) * 1000
  const rowsMs = (estimate.estRows / throughputHint.rowsPerSec) * 1000
  return Math.round(bytesMs + rowsMs)
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export type CostConfidence = 'low' | 'medium' | 'high'

/**
 * 'high' — every read step has index-pruning info AND known column/row
 *   stats. 'medium' — one of the two is missing on some step. 'low' — no
 *   ReadFromMergeTree step was found at all, or every step is missing both.
 */
function deriveConfidence(
  plan: ParsedExplainPlan,
  columnStats: ColumnStatsByTable
): CostConfidence {
  if (plan.reads.length === 0) return 'low'

  let allPruned = true
  let allSized = true
  for (const step of plan.reads) {
    const hasGranules = step.indexes.some(
      (idx) => typeof idx.selectedGranules === 'number'
    )
    if (!hasGranules) allPruned = false
    const stats = step.table ? columnStats.get(step.table) : undefined
    if (!stats?.totalRows) allSized = false
  }

  if (allPruned && allSized) return 'high'
  if (allPruned || allSized) return 'medium'
  return 'low'
}

// ---------------------------------------------------------------------------
// estimateQueryCost — orchestration (I/O via readOnlyQuery, mockable)
// ---------------------------------------------------------------------------

export interface QueryCostEstimate {
  estRows: number
  estBytesRead: number
  estPeakMemoryBytes: number
  estWallMs: number
  confidence: CostConfidence
  warnings: string[]
}

/**
 * Estimate a query's rows scanned / bytes read / peak memory / wall time
 * from EXPLAIN alone.
 *
 * READ-ONLY / never-execute: `sql` is validated first (rejects non-SELECT-
 * shaped input, e.g. ALTER/DROP/INSERT, before any query is sent) and is
 * then only ever sent wrapped inside an `EXPLAIN` statement — `sql` itself
 * is never passed to `readOnlyQuery` on its own.
 */
export async function estimateQueryCost(params: {
  sql: string
  hostId: number
  throughputHint?: ThroughputHint
}): Promise<QueryCostEstimate> {
  const { hostId, throughputHint } = params
  const sql = validateAgentSql(params.sql)

  const explainRows = (await readOnlyQuery({
    query: `EXPLAIN json = 1, header = 1, indexes = 1 ${sql}`,
    hostId,
  })) as Array<{ explain?: string }>

  const explainJson = parseExplainJsonRows(explainRows)
  if (explainJson === null) {
    return {
      estRows: 0,
      estBytesRead: 0,
      estPeakMemoryBytes: 0,
      estWallMs: 0,
      confidence: 'low',
      warnings: [
        'Could not parse the EXPLAIN JSON output for this query — estimate unavailable.',
      ],
    }
  }

  const plan = parseExplainPlan(explainJson)

  const uniqueTables = [
    ...new Set(
      plan.reads
        .map((r) => r.table)
        .filter((t): t is string => Boolean(t?.includes('.')))
    ),
  ].map((key) => {
    const [database, table] = key.split('.')
    return { database, table }
  })

  const columnStats = await fetchColumnStats(hostId, uniqueTables)

  const { estRows, estBytesRead, estPeakMemoryBytes, warnings } =
    estimateRowsAndMemory(plan, columnStats)
  const estWallMs = estimateWallMs(
    { estRows, estBytesRead },
    throughputHint ?? DEFAULT_THROUGHPUT_HINT
  )
  const confidence = deriveConfidence(plan, columnStats)

  return {
    estRows,
    estBytesRead,
    estPeakMemoryBytes,
    estWallMs,
    confidence,
    warnings,
  }
}
