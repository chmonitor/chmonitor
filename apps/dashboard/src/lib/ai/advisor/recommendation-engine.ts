/**
 * Query advisor — recommendation engine.
 *
 * Given a slow query (raw SQL or a `query_id` from `system.query_log`), scores
 * candidate ClickHouse-specific optimizations (skip-index, projection,
 * partition key, PREWHERE rewrite) and returns them **ranked by estimated
 * granules/bytes saved**. See plans/46-query-advisor-engine.md.
 *
 * ABSOLUTE INVARIANT: this module RECOMMENDS ONLY. Nothing here executes,
 * applies, or mutates anything — `analyzeQuery` and every scorer below only
 * ever issue read-only queries (`readOnlyQuery`, which forces
 * `clickhouse_settings.readonly = '1'`) and return inert data (strings +
 * numbers). This module intentionally has no function that runs a
 * recommendation's DDL/rewrite against ClickHouse, and none should ever be
 * added here — see `analyze-query.test.ts` for the enforcing test.
 *
 * Design (mirrors `capacity-forecaster.ts` in this same directory):
 *  - Pure scorers (`scoreSkipIndex`, `scoreProjection`, `scorePartitionKey`)
 *    take an already-gathered `QueryContext` and return a `Recommendation`
 *    or `null` — no I/O, fully unit-testable with fixtures.
 *  - `analyzeQuery` is the thin orchestration layer: resolves the SQL,
 *    gathers EXPLAIN/schema/parts/columns read-only, builds the
 *    `QueryContext`, and calls the scorers (plus the PREWHERE rewrite scorer
 *    in `sql-rewriter.ts`).
 *
 * Every `estImpact` is an ESTIMATE (honest claims) — see `impact-estimator.ts`
 * for how granule/byte numbers are derived, and note in each recommendation's
 * summary that flags it as an upper bound rather than a guaranteed result.
 */

import type {
  ColumnStat,
  EffortLevel,
  EstimatedImpact,
  ExistingSkipIndex,
  ExplainIndexesInfo,
  PartsStats,
  PrimaryKeyExplain,
  QueryContext,
  Recommendation,
  RecommendationKind,
  RiskLevel,
  SkipIndexExplain,
  SqlPredicate,
  TableSchema,
} from './types'

import {
  estimateBytesSaved,
  measurePrewhereImpact,
  summarizeImpact,
} from './impact-estimator'
import { proposePrewhereRewrite } from './sql-rewriter'
import { validateSqlQuery } from '@chm/sql-builder'
import { readOnlyQuery } from '@/lib/ai/agent/tools/helpers'
import {
  extractReferencedTables,
  formatQualifiedTable,
  quoteIdentifier,
} from '@/lib/ai/agent/tools/sql-analysis'

// Re-exported so existing `from './recommendation-engine'` imports (tests,
// tool wiring) keep working unchanged — see `./types` for why these live
// there (breaks an import cycle with impact-estimator.ts/sql-rewriter.ts).
export type {
  ColumnStat,
  EffortLevel,
  EstimatedImpact,
  ExistingSkipIndex,
  ExplainIndexesInfo,
  PartsStats,
  PrimaryKeyExplain,
  QueryContext,
  Recommendation,
  RecommendationKind,
  RiskLevel,
  SkipIndexExplain,
  SqlPredicate,
  TableSchema,
}

/** Numeric ordering used to break ties when granules-saved estimates match. */
const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 }
const EFFORT_ORDER: Record<EffortLevel, number> = { low: 0, medium: 1, high: 2 }

// ---------------------------------------------------------------------------
// SQL parsing helpers — best-effort, top-level only (no nested parens/OR
// handling). Degrades to "nothing extracted" rather than throwing, matching
// the "read-only, degrade gracefully" invariant. Reuses the existing
// sql-analysis.ts extractors for table names where possible.
// ---------------------------------------------------------------------------

const RANGE_OPERATORS = new Set(['<', '>', '<=', '>=', 'BETWEEN'])
const EQUALITY_OPERATORS = new Set(['=', 'IN'])

/**
 * Extract top-level `WHERE`/`AND`-joined predicates as `{ column, operator }`.
 * Deliberately excludes `OR`-joined and `PREWHERE`/`ON` conditions — this
 * engine only reasons about conditions it can confidently attribute to a
 * single column with AND semantics (same scoping as the existing
 * `WHERE_COLUMN_PATTERN` in `agent/tools/sql-analysis.ts`, but this one also
 * captures the operator so callers can tell equality/IN from range).
 */
export function extractPredicates(sql: string): SqlPredicate[] {
  const pattern =
    /\b(?:WHERE|AND)\s+(?:\w+\.)?(`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*)\s*(=|!=|<>|<=|>=|<|>|\bIN\b|\bBETWEEN\b|\bLIKE\b|\bILIKE\b)/gi
  const predicates: SqlPredicate[] = []
  for (const match of sql.matchAll(pattern)) {
    const rawColumn = match[1]
    const column = rawColumn.replace(/^[`"]|[`"]$/g, '').trim()
    const operator = match[2].toUpperCase()
    if (!column) continue
    predicates.push({
      column,
      operator,
      isRange: RANGE_OPERATORS.has(operator),
      isEqualityOrIn: EQUALITY_OPERATORS.has(operator),
    })
  }
  return predicates
}

/** Extract a simple comma-separated column list following `GROUP BY` or `ORDER BY`. Expressions (containing `(`) are skipped — conservative to avoid false schema-mismatch positives. */
export function extractClauseColumns(
  sql: string,
  keyword: 'GROUP BY' | 'ORDER BY'
): string[] {
  const stopWords = 'ORDER BY|GROUP BY|LIMIT|HAVING|SETTINGS|FORMAT|WITH|UNION'
  const re = new RegExp(
    `\\b${keyword}\\b\\s+([\\s\\S]*?)(?=\\b(?:${stopWords})\\b|;|$)`,
    'i'
  )
  const match = sql.match(re)
  if (!match) return []

  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.includes('('))
    .map((part) => part.replace(/\s+(ASC|DESC)$/i, '').trim())
    .map((part) => part.replace(/^[`"]|[`"]$/g, ''))
    .filter(Boolean)
}

/**
 * Parse `EXPLAIN PLAN indexes=1` text output into structured granule/part
 * counts. Best-effort line-scanner (not a real parser) — tolerant of missing
 * sections; returns `primaryKey: null` / `skipIndexes: []` rather than
 * throwing when the shape doesn't match what it expects (degrades
 * gracefully, e.g. non-MergeTree tables or older/newer CH output variants).
 */
export function parseExplainIndexes(
  explainLines: string[]
): ExplainIndexesInfo {
  let primaryKey: PrimaryKeyExplain | null = null
  const skipIndexes: SkipIndexExplain[] = []
  let section: 'none' | 'primaryKey' | 'skip' = 'none'
  let currentSkip: Partial<SkipIndexExplain> | null = null

  const flushSkip = () => {
    if (
      currentSkip &&
      currentSkip.partsTotal !== undefined &&
      currentSkip.granulesTotal !== undefined
    ) {
      skipIndexes.push({
        name: currentSkip.name ?? 'unknown',
        description: currentSkip.description ?? '',
        partsRead: currentSkip.partsRead ?? 0,
        partsTotal: currentSkip.partsTotal,
        granulesRead: currentSkip.granulesRead ?? 0,
        granulesTotal: currentSkip.granulesTotal,
      })
    }
    currentSkip = null
  }

  for (const raw of explainLines) {
    const line = raw.trim()

    if (/^PrimaryKey$/i.test(line)) {
      section = 'primaryKey'
      primaryKey = {
        partsRead: 0,
        partsTotal: 0,
        granulesRead: 0,
        granulesTotal: 0,
      }
      continue
    }
    if (/^Skip$/i.test(line)) {
      flushSkip()
      section = 'skip'
      currentSkip = {}
      continue
    }
    // Any other bare section header (Partition, Condition, Keys, ...) ends
    // the current Skip/PrimaryKey block's field capture but we keep scanning
    // in case Parts/Granules appear a couple of lines later within it.
    const nameMatch = line.match(/^Name:\s*(.+)$/i)
    if (nameMatch && section === 'skip' && currentSkip) {
      currentSkip.name = nameMatch[1].trim()
      continue
    }
    const descMatch = line.match(/^Description:\s*(.+)$/i)
    if (descMatch && section === 'skip' && currentSkip) {
      currentSkip.description = descMatch[1].trim()
      continue
    }
    const partsMatch = line.match(/^Parts:\s*(\d+)\/(\d+)/i)
    if (partsMatch) {
      const partsRead = Number(partsMatch[1])
      const partsTotal = Number(partsMatch[2])
      if (section === 'primaryKey' && primaryKey) {
        primaryKey.partsRead = partsRead
        primaryKey.partsTotal = partsTotal
      } else if (section === 'skip' && currentSkip) {
        currentSkip.partsRead = partsRead
        currentSkip.partsTotal = partsTotal
      }
      continue
    }
    const granulesMatch = line.match(/^Granules:\s*(\d+)\/(\d+)/i)
    if (granulesMatch) {
      const granulesRead = Number(granulesMatch[1])
      const granulesTotal = Number(granulesMatch[2])
      if (section === 'primaryKey' && primaryKey) {
        primaryKey.granulesRead = granulesRead
        primaryKey.granulesTotal = granulesTotal
      } else if (section === 'skip' && currentSkip) {
        currentSkip.granulesRead = granulesRead
        currentSkip.granulesTotal = granulesTotal
      }
    }
  }
  flushSkip()

  return { primaryKey, skipIndexes }
}

// ---------------------------------------------------------------------------
// Pure scorers — no I/O. Each returns a Recommendation, or null when the
// heuristic's trigger condition doesn't apply to this QueryContext.
// ---------------------------------------------------------------------------

const DEFAULT_GRANULARITY = 4

/**
 * Skip-index scorer: a selective predicate on a column that is NOT part of
 * the table's sorting key (so the sparse primary-key index can't prune it).
 * Picks `set`/`bloom_filter`-style index for equality/IN, `minmax` for range.
 */
export function scoreSkipIndex(ctx: QueryContext): Recommendation[] {
  const results: Recommendation[] = []
  const alreadyIndexed = new Set(
    ctx.schema.existingSkipIndexes.map((i) => i.expression.trim())
  )

  for (const predicate of ctx.predicates) {
    if (ctx.schema.sortingKeyColumns.includes(predicate.column)) continue
    if (alreadyIndexed.has(predicate.column)) continue
    if (!predicate.isEqualityOrIn && !predicate.isRange) continue

    const indexType = predicate.isEqualityOrIn ? 'set(100)' : 'minmax'
    const indexName = `idx_${predicate.column}_${predicate.isEqualityOrIn ? 'set' : 'minmax'}`
    const fullTable = formatQualifiedTable(ctx.database, ctx.table)
    const ddl = `ALTER TABLE ${fullTable} ADD INDEX ${quoteIdentifier(indexName)} ${quoteIdentifier(predicate.column)} TYPE ${indexType} GRANULARITY ${DEFAULT_GRANULARITY}`

    const granulesRead = ctx.explain?.primaryKey?.granulesRead ?? 0
    const granulesTotal =
      ctx.explain?.primaryKey?.granulesTotal ?? ctx.parts.totalGranules
    const unknown = !ctx.explain?.primaryKey || granulesTotal === 0
    const estImpact = summarizeImpact({
      granulesRead,
      granulesTotal,
      // Optimistic upper bound: assume the new index prunes every granule
      // this query currently reads that the PK/existing indexes don't.
      granulesSaved: unknown ? 0 : granulesRead,
      tableBytes: ctx.parts.totalBytes,
      unknown,
      label: `skip index on \`${predicate.column}\``,
    })

    results.push({
      kind: 'skip_index',
      title: `Add a skip index on \`${predicate.column}\``,
      rationale: `\`${predicate.column}\` is filtered with ${predicate.operator} but is not part of the table's sorting key (${ctx.schema.sortingKeyColumns.join(', ') || '(none)'}), so the sparse primary-key index cannot prune on it.`,
      ddl,
      risk: 'low',
      riskNote:
        'Adding a skip index is additive: it does not change query results and can be dropped again (`ALTER TABLE ... DROP INDEX`). It adds minor storage and background-merge overhead, and only helps if the predicate is selective on this data — validate with EXPLAIN after adding it.',
      effort: 'low',
      estImpact,
    })
  }

  return results
}

/**
 * Projection scorer: the query's GROUP BY / ORDER BY doesn't match (as a
 * prefix of) the table's sorting key, forcing an in-memory sort/aggregate
 * over data ordered for something else.
 */
export function scoreProjection(ctx: QueryContext): Recommendation | null {
  const targetColumns =
    ctx.groupByColumns.length > 0 ? ctx.groupByColumns : ctx.orderByColumns
  if (targetColumns.length === 0) return null

  const sortingPrefix = ctx.schema.sortingKeyColumns.slice(
    0,
    targetColumns.length
  )
  const matchesPrefix = targetColumns.every(
    (col, i) => sortingPrefix[i] === col
  )
  if (matchesPrefix) return null

  const fullTable = formatQualifiedTable(ctx.database, ctx.table)
  const projectionName = `proj_${targetColumns.join('_')}`.slice(0, 64)
  const clause = ctx.groupByColumns.length > 0 ? 'GROUP BY' : 'ORDER BY'
  const selectList =
    ctx.groupByColumns.length > 0
      ? `${targetColumns.map(quoteIdentifier).join(', ')}, count() AS cnt`
      : '*'
  const ddl = `ALTER TABLE ${fullTable} ADD PROJECTION ${quoteIdentifier(projectionName)} (SELECT ${selectList} ${clause} ${targetColumns.map(quoteIdentifier).join(', ')})`

  const granulesRead =
    ctx.explain?.primaryKey?.granulesRead ?? ctx.parts.totalGranules
  const granulesTotal =
    ctx.explain?.primaryKey?.granulesTotal ?? ctx.parts.totalGranules
  const unknown = granulesTotal === 0
  const estImpact = summarizeImpact({
    granulesRead,
    granulesTotal,
    // Projections avoid re-sorting/re-aggregating the granules the query
    // already reads, rather than pruning more of them — the "saved" figure
    // here estimates avoided sort/aggregate cost, not additional pruning.
    granulesSaved: unknown ? 0 : granulesRead,
    tableBytes: ctx.parts.totalBytes,
    unknown,
    label: 'a matching projection',
  })

  return {
    kind: 'projection',
    title: `Add a projection ordered by ${targetColumns.join(', ')}`,
    rationale: `The query's ${clause} (${targetColumns.join(', ')}) does not match a prefix of the table's sorting key (${ctx.schema.sortingKeyColumns.join(', ') || '(none)'}), forcing ClickHouse to sort/aggregate in memory instead of reading pre-sorted data.`,
    ddl: `${ddl}\n-- Adjust the SELECT list above to your actual aggregates before running; this is illustrative.\n-- After adding, backfill existing parts: ALTER TABLE ${fullTable} MATERIALIZE PROJECTION ${quoteIdentifier(projectionName)};`,
    risk: 'medium',
    riskNote:
      'Projections duplicate data in a second physical layout: they increase storage and write/merge cost, and existing parts need an explicit MATERIALIZE PROJECTION backfill before they help older data. Validate the SELECT list matches your real aggregates.',
    effort: 'medium',
    estImpact,
  }
}

/**
 * Partition-key scorer: a range filter on a Date/DateTime column that is not
 * part of the partition key today, so no parts are pruned by partition.
 * Always high-effort/high-risk — this cannot be `ALTER`ed in place.
 */
export function scorePartitionKey(ctx: QueryContext): Recommendation | null {
  const candidate = ctx.predicates.find(
    (p) =>
      p.isRange &&
      !ctx.schema.partitionKeyColumns.includes(p.column) &&
      ctx.schema.columns.some(
        (c) => c.name === p.column && /^(Date|DateTime)/.test(c.type)
      )
  )
  if (!candidate) return null

  const fullTable = formatQualifiedTable(ctx.database, ctx.table)
  const granulesRead =
    ctx.explain?.primaryKey?.granulesRead ?? ctx.parts.totalGranules
  const granulesTotal =
    ctx.explain?.primaryKey?.granulesTotal ?? ctx.parts.totalGranules
  const unknown = granulesTotal === 0
  const estImpact = summarizeImpact({
    granulesRead,
    granulesTotal,
    granulesSaved: unknown ? 0 : granulesRead,
    tableBytes: ctx.parts.totalBytes,
    unknown,
    label: `partitioning by \`${candidate.column}\``,
  })

  return {
    kind: 'partition_key',
    title: `Consider partitioning by \`${candidate.column}\``,
    rationale: `The query range-filters on \`${candidate.column}\` (${candidate.operator}), but the table's current partition key (${ctx.schema.partitionKeyColumns.join(', ') || '(none)'}) does not include it, so no whole parts can be skipped by partition pruning today.`,
    ddl: `-- PARTITION BY cannot be changed with ALTER on an existing table. Rebuild required, e.g.:\nCREATE TABLE ${quoteIdentifier(ctx.table)}_new AS ${fullTable}\n  PARTITION BY toYYYYMM(${quoteIdentifier(candidate.column)});\nINSERT INTO ${quoteIdentifier(ctx.table)}_new SELECT * FROM ${fullTable};\n-- verify row counts/queries against the new table, then RENAME TABLE to swap it in.`,
    risk: 'high',
    riskNote:
      'Changing the partition key requires rebuilding the table (CREATE + INSERT SELECT + RENAME), which takes a full copy of the data, doubles storage during the rebuild, and needs a maintenance window. Also re-check any other queries that rely on the current partitioning before committing to this change.',
    effort: 'high',
    estImpact,
  }
}

// ---------------------------------------------------------------------------
// Orchestration — gathers read-only data, builds QueryContext, ranks output.
// ---------------------------------------------------------------------------

export interface AnalyzeQueryInput {
  hostId: number
  sql?: string
  queryId?: string
  database?: string
}

export interface AnalyzeQueryOk {
  ok: true
  /** Discriminator the chat UI's tool-output renderer keys off (see `components/agents/chat/tool-output.tsx`) to show `AdvisorRecommendationsPanel` instead of a raw JSON dump. */
  type: 'query_advisor_recommendations'
  sql: string
  database: string
  table: string
  recommendations: Recommendation[]
  notes: string[]
}

export interface AnalyzeQueryError {
  ok: false
  error: string
}

export type AnalyzeQueryResult = AnalyzeQueryOk | AnalyzeQueryError

async function resolveSql(
  hostId: number,
  sql: string | undefined,
  queryId: string | undefined
): Promise<string | null> {
  if (sql?.trim()) return sql.trim()
  if (!queryId?.trim()) return null

  const rows = (await readOnlyQuery({
    query:
      "SELECT query FROM system.query_log WHERE query_id = {queryId:String} AND type = 'QueryFinish' ORDER BY event_time DESC LIMIT 1",
    query_params: { queryId },
    hostId,
  })) as Array<{ query: string }>

  return rows[0]?.query?.trim() ?? null
}

async function fetchTableSchema(
  hostId: number,
  database: string,
  table: string
): Promise<TableSchema> {
  const [tableRows, columnRows, indexRows] = await Promise.all([
    readOnlyQuery({
      query:
        'SELECT partition_key, sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String}',
      query_params: { database, table },
      hostId,
    }) as Promise<Array<{ partition_key: string; sorting_key: string }>>,
    readOnlyQuery({
      query:
        'SELECT name, type, is_in_partition_key, is_in_sorting_key, data_compressed_bytes, data_uncompressed_bytes FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
      query_params: { database, table },
      hostId,
    }) as Promise<
      Array<{
        name: string
        type: string
        is_in_partition_key: number | string
        is_in_sorting_key: number | string
        data_compressed_bytes: number | string
        data_uncompressed_bytes: number | string
      }>
    >,
    readOnlyQuery({
      query:
        'SELECT name, type, expression, granularity FROM system.data_skipping_indexes WHERE database = {database:String} AND table = {table:String}',
      query_params: { database, table },
      hostId,
    }) as Promise<
      Array<{
        name: string
        type: string
        expression: string
        granularity: number | string
      }>
    >,
  ])

  const truthy = (v: number | string) => Number(v) === 1
  const splitKey = (key: string) =>
    key
      ? key
          .split(',')
          .map((s) => s.trim().replace(/^[`"]|[`"]$/g, ''))
          .filter(Boolean)
      : []
  // `partition_key` is a full expression (e.g. `toYYYYMM(event_date)`, or
  // `(region, toYYYYMM(event_date))`), not a bare column list like
  // `sorting_key` usually is — a comma-split would miss that `event_date` is
  // already covered. Extract identifier-like tokens instead so `.includes()`
  // checks against it catch the column-wrapped-in-a-function case (accepting
  // that a function name like `toYYYYMM` is harmlessly captured as a token
  // too — false positives here just mean "assume already covered").
  const extractIdentifierTokens = (expr: string) =>
    [...expr.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)].map((m) => m[0])

  return {
    database,
    table,
    partitionKeyColumns: extractIdentifierTokens(
      tableRows[0]?.partition_key ?? ''
    ),
    // sorting_key is matched by exact column equality (skip-index/projection
    // scorers) — this only recognizes bare column names, not expressions
    // (e.g. `toDate(created_at)`); a sorting key built from expressions is a
    // documented limitation, not a crash risk.
    sortingKeyColumns: splitKey(tableRows[0]?.sorting_key ?? ''),
    columns: columnRows.map((c) => ({
      name: c.name,
      type: c.type,
      isInPartitionKey: truthy(c.is_in_partition_key),
      isInSortingKey: truthy(c.is_in_sorting_key),
      compressedBytes: Number(c.data_compressed_bytes),
      uncompressedBytes: Number(c.data_uncompressed_bytes),
    })),
    existingSkipIndexes: indexRows.map((i) => ({
      name: i.name,
      type: i.type,
      expression: i.expression,
      granularity: Number(i.granularity),
    })),
  }
}

async function fetchPartsStats(
  hostId: number,
  database: string,
  table: string
): Promise<PartsStats> {
  const rows = (await readOnlyQuery({
    query:
      'SELECT count() AS active_parts, sum(rows) AS total_rows, sum(bytes_on_disk) AS total_bytes, sum(marks) AS total_granules FROM system.parts WHERE active = 1 AND database = {database:String} AND table = {table:String}',
    query_params: { database, table },
    hostId,
  })) as Array<{
    active_parts: number | string
    total_rows: number | string
    total_bytes: number | string
    total_granules: number | string
  }>

  const row = rows[0]
  return {
    activeParts: Number(row?.active_parts ?? 0),
    totalRows: Number(row?.total_rows ?? 0),
    totalBytes: Number(row?.total_bytes ?? 0),
    totalGranules: Number(row?.total_granules ?? 0),
  }
}

/** Best-effort `EXPLAIN PLAN indexes=1`; returns `null` (never throws) if the query can't be explained. */
async function fetchExplainIndexes(
  hostId: number,
  sql: string
): Promise<ExplainIndexesInfo | null> {
  try {
    const rows = (await readOnlyQuery({
      query: `EXPLAIN PLAN indexes = 1 ${sql}`,
      hostId,
    })) as Array<{ explain: string }>
    return parseExplainIndexes(rows.map((r) => r.explain))
  } catch {
    return null
  }
}

/** Rank recommendations by estimated granules saved (desc), tie-broken by lower risk then lower effort. */
export function rankRecommendations(
  recommendations: Recommendation[]
): Recommendation[] {
  return [...recommendations].sort((a, b) => {
    if (b.estImpact.granulesSaved !== a.estImpact.granulesSaved) {
      return b.estImpact.granulesSaved - a.estImpact.granulesSaved
    }
    if (RISK_ORDER[a.risk] !== RISK_ORDER[b.risk]) {
      return RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
    }
    return EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort]
  })
}

/**
 * Analyze a slow query and return ranked optimization recommendations.
 * Read-only end to end: EXPLAIN, `system.tables`/`system.columns`/
 * `system.data_skipping_indexes`/`system.parts` are all read via
 * `readOnlyQuery` (forces `clickhouse_settings.readonly = '1'`). Degrades
 * gracefully — a missing/inaccessible table or a failed EXPLAIN reduces what
 * can be estimated rather than throwing.
 */
export async function analyzeQuery(
  input: AnalyzeQueryInput
): Promise<AnalyzeQueryResult> {
  const { hostId, database = 'default' } = input
  const notes: string[] = []

  let sql: string | null
  try {
    sql = await resolveSql(hostId, input.sql, input.queryId)
  } catch (err) {
    return {
      ok: false,
      error: `Could not resolve query_id: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (!sql) {
    return {
      ok: false,
      error: input.queryId
        ? `No finished query found in system.query_log for query_id "${input.queryId}".`
        : 'Provide either `sql` or `queryId`.',
    }
  }

  try {
    validateSqlQuery(sql)
  } catch (err) {
    return {
      ok: false,
      error: `Query failed validation: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const referencedTables = extractReferencedTables(sql, database)
  const target = referencedTables[0]
  if (!target) {
    return {
      ok: false,
      error:
        'Could not identify a target table in the query (no FROM/JOIN found).',
    }
  }
  if (referencedTables.length > 1) {
    notes.push(
      `Query references ${referencedTables.length} tables; only \`${target.qualifiedName}\` (the first) was analyzed.`
    )
  }

  let schema: TableSchema
  let parts: PartsStats
  try {
    ;[schema, parts] = await Promise.all([
      fetchTableSchema(hostId, target.database, target.table),
      fetchPartsStats(hostId, target.database, target.table),
    ])
  } catch (err) {
    return {
      ok: false,
      error: `Could not read schema/parts for ${target.qualifiedName}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const explain = await fetchExplainIndexes(hostId, sql)
  if (!explain) {
    notes.push(
      'EXPLAIN failed or was not permitted — impact estimates fall back to table-wide totals and are less precise.'
    )
  }

  const ctx: QueryContext = {
    sql,
    database: target.database,
    table: target.table,
    predicates: extractPredicates(sql),
    groupByColumns: extractClauseColumns(sql, 'GROUP BY'),
    orderByColumns: extractClauseColumns(sql, 'ORDER BY'),
    hasPrewhere: /\bPREWHERE\b/i.test(sql),
    schema,
    parts,
    explain,
  }

  const projectionRecommendation = scoreProjection(ctx)
  const partitionKeyRecommendation = scorePartitionKey(ctx)
  const recommendations: Recommendation[] = [
    ...scoreSkipIndex(ctx),
    ...(projectionRecommendation ? [projectionRecommendation] : []),
    ...(partitionKeyRecommendation ? [partitionKeyRecommendation] : []),
  ]

  if (!ctx.hasPrewhere) {
    const prewhereCandidate = proposePrewhereRewrite(ctx)
    if (prewhereCandidate) {
      const impact = await measurePrewhereImpact({
        hostId,
        originalSql: sql,
        rewrittenSql: prewhereCandidate.rewrittenSql,
        fallbackGranulesRead:
          ctx.explain?.primaryKey?.granulesRead ?? ctx.parts.totalGranules,
        fallbackGranulesTotal:
          ctx.explain?.primaryKey?.granulesTotal ?? ctx.parts.totalGranules,
        tableBytes: ctx.parts.totalBytes,
        movedColumn: prewhereCandidate.movedPredicate.column,
      })
      recommendations.push({
        kind: 'prewhere',
        title: `Move \`${prewhereCandidate.movedPredicate.column}\` into PREWHERE`,
        rationale: `\`${prewhereCandidate.movedPredicate.column}\` is a selective WHERE condition; evaluating it in PREWHERE filters rows before ClickHouse reads the remaining (wider) columns.`,
        ddl: null,
        rewrittenSql: prewhereCandidate.rewrittenSql,
        risk: 'low',
        riskNote:
          'PREWHERE does not change query semantics for a normal single-table SELECT. Double-check results still match if the query uses FINAL, replicated deduplication, or non-deterministic functions in the moved condition.',
        effort: 'low',
        estImpact: impact,
      })
    }
  }

  return {
    ok: true,
    type: 'query_advisor_recommendations',
    sql,
    database: target.database,
    table: target.table,
    recommendations: rankRecommendations(recommendations),
    notes,
  }
}

export { estimateBytesSaved }
