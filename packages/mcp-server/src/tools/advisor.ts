/**
 * Query advisor MCP tool — analyzes a slow query and returns ranked,
 * recommend-only DDL/rewrite suggestions (skip-index, projection, partition
 * key, PREWHERE). See plans/46-query-advisor-engine.md.
 *
 * DUPLICATION NOTE: the pure parsing/scoring/impact/rewrite logic below is a
 * byte-for-byte copy of
 * `apps/dashboard/src/lib/ai/advisor/{recommendation-engine,impact-estimator,sql-rewriter}.ts`.
 * `packages/*` may not import from `apps/*` (depcruise `no-packages-to-apps`
 * — see `.dependency-cruiser.cjs`), so this MCP surface cannot reuse the
 * dashboard app's engine directly. If you change the scoring/DDL logic in
 * the dashboard version, copy the same change here so the two surfaces never
 * disagree on what they recommend for the same query. Only the I/O layer
 * differs (`runReadonlyFetch` here vs. the dashboard's `readOnlyQuery`).
 *
 * ABSOLUTE INVARIANT: recommend-only. Nothing here executes, applies, or
 * mutates anything — every ClickHouse call goes through `runReadonlyFetch`
 * (which forces `clickhouse_settings.readonly = '1'`), and the returned
 * recommendations are inert DDL/rewrite text, never executed.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import {
  hostIdSchema,
  runReadonlyFetch,
  toErrorResult,
  toJsonResult,
} from './helpers'
import { z } from 'zod/v3'

// ---------------------------------------------------------------------------
// Types (copy of recommendation-engine.ts's shared types)
// ---------------------------------------------------------------------------

type RecommendationKind =
  | 'skip_index'
  | 'projection'
  | 'partition_key'
  | 'prewhere'
type RiskLevel = 'low' | 'medium' | 'high'
type EffortLevel = 'low' | 'medium' | 'high'

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 }
const EFFORT_ORDER: Record<EffortLevel, number> = { low: 0, medium: 1, high: 2 }

interface EstimatedImpact {
  granulesSaved: number
  granulesRead: number
  bytesSaved: number
  summary: string
  unknown: boolean
}

interface Recommendation {
  kind: RecommendationKind
  title: string
  rationale: string
  ddl: string | null
  rewrittenSql?: string
  risk: RiskLevel
  riskNote: string
  effort: EffortLevel
  estImpact: EstimatedImpact
}

interface SqlPredicate {
  column: string
  operator: string
  isRange: boolean
  isEqualityOrIn: boolean
}

interface ColumnStat {
  name: string
  type: string
  isInPartitionKey: boolean
  isInSortingKey: boolean
  compressedBytes: number
  uncompressedBytes: number
}

interface ExistingSkipIndex {
  name: string
  type: string
  expression: string
  granularity: number
}

interface TableSchema {
  database: string
  table: string
  partitionKeyColumns: string[]
  sortingKeyColumns: string[]
  columns: ColumnStat[]
  existingSkipIndexes: ExistingSkipIndex[]
}

interface PartsStats {
  activeParts: number
  totalRows: number
  totalBytes: number
  totalGranules: number
}

interface PrimaryKeyExplain {
  partsRead: number
  partsTotal: number
  granulesRead: number
  granulesTotal: number
}

interface SkipIndexExplain {
  name: string
  description: string
  partsRead: number
  partsTotal: number
  granulesRead: number
  granulesTotal: number
}

interface ExplainIndexesInfo {
  primaryKey: PrimaryKeyExplain | null
  skipIndexes: SkipIndexExplain[]
}

interface QueryContext {
  sql: string
  database: string
  table: string
  predicates: SqlPredicate[]
  groupByColumns: string[]
  orderByColumns: string[]
  hasPrewhere: boolean
  schema: TableSchema
  parts: PartsStats
  explain: ExplainIndexesInfo | null
}

// ---------------------------------------------------------------------------
// SQL parsing helpers (copy of recommendation-engine.ts)
// ---------------------------------------------------------------------------

const RANGE_OPERATORS = new Set(['<', '>', '<=', '>=', 'BETWEEN'])
const EQUALITY_OPERATORS = new Set(['=', 'IN'])

function extractPredicates(sql: string): SqlPredicate[] {
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

function extractClauseColumns(
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

function parseExplainIndexes(explainLines: string[]): ExplainIndexesInfo {
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
// Small SQL/identifier utilities (copy of the relevant bits of
// apps/dashboard/src/lib/ai/agent/tools/sql-analysis.ts — same
// depcruise-driven duplication rationale as above).
// ---------------------------------------------------------------------------

const TABLE_REFERENCE_PATTERN =
  /\b(?:FROM|JOIN)\s+((?:`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*))?)/gi

function stripQuotedIdentifier(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function normalizeIdentifier(value: string): string {
  return stripQuotedIdentifier(value.trim()).replace(/\s+/g, '')
}

function extractReferencedTables(
  sql: string,
  defaultDatabase = 'default'
): Array<{ database: string; table: string; qualifiedName: string }> {
  const tables = new Map<
    string,
    { database: string; table: string; qualifiedName: string }
  >()

  for (const match of sql.matchAll(TABLE_REFERENCE_PATTERN)) {
    const raw = match[1]
    if (!raw || raw.startsWith('(')) continue
    const parts = raw.split('.').map(normalizeIdentifier).filter(Boolean)
    const database = parts.length > 1 ? parts[0] : defaultDatabase
    const table = parts.length > 1 ? parts[1] : parts[0]
    if (!database || !table) continue
    const qualifiedName = `${database}.${table}`
    if (!tables.has(qualifiedName)) {
      tables.set(qualifiedName, { database, table, qualifiedName })
    }
  }

  return [...tables.values()]
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``
}

function formatQualifiedTable(database: string, table: string): string {
  return `${quoteIdentifier(database)}.${quoteIdentifier(table)}`
}

// ---------------------------------------------------------------------------
// Impact estimation (copy of impact-estimator.ts's pure parts)
// ---------------------------------------------------------------------------

function estimateBytesSaved(
  granulesSaved: number,
  granulesTotal: number,
  tableBytes: number
): number {
  if (granulesTotal <= 0 || granulesSaved <= 0) return 0
  const fraction = Math.min(1, granulesSaved / granulesTotal)
  return Math.round(fraction * tableBytes)
}

function formatBytesShort(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KiB`
  return `${bytes} B`
}

function summarizeImpact(input: {
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

// ---------------------------------------------------------------------------
// Pure scorers (copy of recommendation-engine.ts)
// ---------------------------------------------------------------------------

const DEFAULT_GRANULARITY = 4

function scoreSkipIndex(ctx: QueryContext): Recommendation[] {
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

function scoreProjection(ctx: QueryContext): Recommendation | null {
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

function scorePartitionKey(ctx: QueryContext): Recommendation | null {
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
// SQL rewriter (copy of sql-rewriter.ts)
// ---------------------------------------------------------------------------

const CLAUSE_STOP_WORDS =
  'GROUP BY|ORDER BY|LIMIT|HAVING|SETTINGS|FORMAT|WITH|UNION'

function splitTopLevelAnd(whereBody: string): string[] {
  const depthAt: number[] = []
  let depth = 0
  for (let i = 0; i < whereBody.length; i++) {
    const ch = whereBody[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    depthAt[i] = depth
  }

  const positions: number[] = []
  const re = /\bAND\b/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(whereBody)) !== null) {
    if (depthAt[match.index] === 0) positions.push(match.index)
  }

  const parts: string[] = []
  let lastIndex = 0
  for (const pos of positions) {
    parts.push(whereBody.slice(lastIndex, pos).trim())
    lastIndex = pos + 3
  }
  parts.push(whereBody.slice(lastIndex).trim())

  return parts.filter(Boolean)
}

function findWhereSpan(
  sql: string
): { start: number; end: number; body: string } | null {
  const re = new RegExp(
    `\\bWHERE\\b\\s+([\\s\\S]*?)(?=\\b(?:${CLAUSE_STOP_WORDS})\\b|;|$)`,
    'i'
  )
  const match = re.exec(sql)
  if (!match || match.index === undefined) return null
  return {
    start: match.index,
    end: match.index + match[0].length,
    body: match[1].trim(),
  }
}

function pickPrewhereCandidate(ctx: QueryContext): SqlPredicate | null {
  if (ctx.predicates.length === 0) return null

  const avgCompressedBytes =
    ctx.schema.columns.length > 0
      ? ctx.schema.columns.reduce((sum, c) => sum + c.compressedBytes, 0) /
        ctx.schema.columns.length
      : 0

  const isCheap = (column: string): boolean => {
    if (avgCompressedBytes <= 0) return true
    const stat = ctx.schema.columns.find((c) => c.name === column)
    return !stat || stat.compressedBytes <= avgCompressedBytes
  }

  const ranked = [...ctx.predicates].sort((a, b) => {
    const aScore = (a.isEqualityOrIn ? 0 : 1) + (isCheap(a.column) ? 0 : 2)
    const bScore = (b.isEqualityOrIn ? 0 : 1) + (isCheap(b.column) ? 0 : 2)
    return aScore - bScore
  })

  return ranked[0] ?? null
}

function proposePrewhereRewrite(
  ctx: QueryContext
): { rewrittenSql: string; movedPredicate: SqlPredicate } | null {
  const span = findWhereSpan(ctx.sql)
  if (!span || !span.body) return null

  const candidate = pickPrewhereCandidate(ctx)
  if (!candidate) return null

  const conditions = splitTopLevelAnd(span.body)
  const matchIndex = conditions.findIndex((cond) =>
    new RegExp(
      `(^|\\.|\\s)${candidate.column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(=|!=|<>|<=|>=|<|>|\\bIN\\b|\\bBETWEEN\\b|\\bLIKE\\b|\\bILIKE\\b)`,
      'i'
    ).test(cond)
  )
  if (matchIndex === -1) return null

  const movedCondition = conditions[matchIndex]
  const remaining = conditions.filter((_, i) => i !== matchIndex)
  const replacement = `PREWHERE ${movedCondition}${remaining.length > 0 ? ` WHERE ${remaining.join(' AND ')}` : ''}`
  const rewrittenSql =
    ctx.sql.slice(0, span.start) + replacement + ctx.sql.slice(span.end)

  return { rewrittenSql, movedPredicate: candidate }
}

// ---------------------------------------------------------------------------
// Ranking (copy of recommendation-engine.ts)
// ---------------------------------------------------------------------------

function rankRecommendations(
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

// ---------------------------------------------------------------------------
// Orchestration — MCP-specific I/O layer using runReadonlyFetch (the rest of
// this file above is identical logic to the dashboard engine).
// ---------------------------------------------------------------------------

/** Runs a read-only fetch and throws on error, mirroring the dashboard's `readOnlyQuery` so the orchestration logic above reads the same way. */
async function readOnly<T>(
  query: string,
  hostId: number,
  query_params?: Record<string, unknown>
): Promise<T> {
  const result = await runReadonlyFetch({ query, hostId, query_params })
  if (result.error) throw new Error(result.error.message)
  return result.data as T
}

async function resolveSql(
  hostId: number,
  sql: string | undefined,
  queryId: string | undefined
): Promise<string | null> {
  if (sql?.trim()) return sql.trim()
  if (!queryId?.trim()) return null

  const rows = await readOnly<Array<{ query: string }>>(
    "SELECT query FROM system.query_log WHERE query_id = {queryId:String} AND type = 'QueryFinish' ORDER BY event_time DESC LIMIT 1",
    hostId,
    { queryId }
  )
  return rows[0]?.query?.trim() ?? null
}

async function fetchTableSchema(
  hostId: number,
  database: string,
  table: string
): Promise<TableSchema> {
  const [tableRows, columnRows, indexRows] = await Promise.all([
    readOnly<Array<{ partition_key: string; sorting_key: string }>>(
      'SELECT partition_key, sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String}',
      hostId,
      { database, table }
    ),
    readOnly<
      Array<{
        name: string
        type: string
        is_in_partition_key: number | string
        is_in_sorting_key: number | string
        data_compressed_bytes: number | string
        data_uncompressed_bytes: number | string
      }>
    >(
      'SELECT name, type, is_in_partition_key, is_in_sorting_key, data_compressed_bytes, data_uncompressed_bytes FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
      hostId,
      { database, table }
    ),
    readOnly<
      Array<{
        name: string
        type: string
        expression: string
        granularity: number | string
      }>
    >(
      'SELECT name, type, expression, granularity FROM system.data_skipping_indexes WHERE database = {database:String} AND table = {table:String}',
      hostId,
      { database, table }
    ),
  ])

  const truthy = (v: number | string) => Number(v) === 1
  const splitKey = (key: string) =>
    key
      ? key
          .split(',')
          .map((s) => s.trim().replace(/^[`"]|[`"]$/g, ''))
          .filter(Boolean)
      : []
  const extractIdentifierTokens = (expr: string) =>
    [...expr.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)].map((m) => m[0])

  return {
    database,
    table,
    partitionKeyColumns: extractIdentifierTokens(
      tableRows[0]?.partition_key ?? ''
    ),
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
  const rows = await readOnly<
    Array<{
      active_parts: number | string
      total_rows: number | string
      total_bytes: number | string
      total_granules: number | string
    }>
  >(
    'SELECT count() AS active_parts, sum(rows) AS total_rows, sum(bytes_on_disk) AS total_bytes, sum(marks) AS total_granules FROM system.parts WHERE active = 1 AND database = {database:String} AND table = {table:String}',
    hostId,
    { database, table }
  )
  const row = rows[0]
  return {
    activeParts: Number(row?.active_parts ?? 0),
    totalRows: Number(row?.total_rows ?? 0),
    totalBytes: Number(row?.total_bytes ?? 0),
    totalGranules: Number(row?.total_granules ?? 0),
  }
}

async function fetchExplainIndexes(
  hostId: number,
  sql: string
): Promise<ExplainIndexesInfo | null> {
  try {
    const rows = await readOnly<Array<{ explain: string }>>(
      `EXPLAIN PLAN indexes = 1 ${sql}`,
      hostId
    )
    return parseExplainIndexes(rows.map((r) => r.explain))
  } catch {
    return null
  }
}

async function measurePrewhereImpact(
  hostId: number,
  originalSql: string,
  rewrittenSql: string,
  fallbackGranulesRead: number,
  fallbackGranulesTotal: number,
  tableBytes: number,
  movedColumn: string
): Promise<EstimatedImpact> {
  try {
    const [before, after] = await Promise.all([
      readOnly<Array<{ marks: number | string }>>(
        `EXPLAIN ESTIMATE ${originalSql}`,
        hostId
      ),
      readOnly<Array<{ marks: number | string }>>(
        `EXPLAIN ESTIMATE ${rewrittenSql}`,
        hostId
      ),
    ])
    const beforeMarks = before.reduce((sum, r) => sum + Number(r.marks ?? 0), 0)
    const afterMarks = after.reduce((sum, r) => sum + Number(r.marks ?? 0), 0)

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

interface AnalyzeQueryResult {
  ok: boolean
  sql?: string
  database?: string
  table?: string
  recommendations?: Recommendation[]
  notes?: string[]
  error?: string
}

async function analyzeQuery(params: {
  hostId: number
  sql?: string
  queryId?: string
  database?: string
}): Promise<AnalyzeQueryResult> {
  const { hostId, database = 'default' } = params
  const notes: string[] = []

  let sql: string | null
  try {
    sql = await resolveSql(hostId, params.sql, params.queryId)
  } catch (err) {
    return {
      ok: false,
      error: `Could not resolve query_id: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (!sql) {
    return {
      ok: false,
      error: params.queryId
        ? `No finished query found in system.query_log for query_id "${params.queryId}".`
        : 'Provide either `sql` or `queryId`.',
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
      const impact = await measurePrewhereImpact(
        hostId,
        sql,
        prewhereCandidate.rewrittenSql,
        ctx.explain?.primaryKey?.granulesRead ?? ctx.parts.totalGranules,
        ctx.explain?.primaryKey?.granulesTotal ?? ctx.parts.totalGranules,
        ctx.parts.totalBytes,
        prewhereCandidate.movedPredicate.column
      )
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
    sql,
    database: target.database,
    table: target.table,
    recommendations: rankRecommendations(recommendations),
    notes,
  }
}

export function registerAdvisorTool(server: McpServer) {
  server.tool(
    'get_optimization_recommendations',
    'Analyze a slow query (by `queryId` from system.query_log, or raw `sql`) and return RANKED optimization recommendations — skip-index, projection, partition key, or a PREWHERE rewrite — each with DDL/rewrite text, rationale, risk, effort, and an estimated granules/bytes saved. Read-only and recommend-only: it never executes or applies any DDL or rewrite.',
    {
      sql: z
        .string()
        .optional()
        .describe('Raw SQL to analyze. Provide this or queryId.'),
      queryId: z
        .string()
        .optional()
        .describe(
          'A query_id from system.query_log to resolve and analyze. Provide this or sql.'
        ),
      database: z
        .string()
        .optional()
        .describe(
          'Default database for unqualified table references (default: "default").'
        ),
      hostId: hostIdSchema,
    },
    async ({ sql, queryId, database, hostId }) => {
      const result = await analyzeQuery({
        hostId: hostId ?? 0,
        sql,
        queryId,
        database,
      })
      if (!result.ok) return toErrorResult(result.error ?? 'Analysis failed.')
      return toJsonResult(result)
    }
  )
}
