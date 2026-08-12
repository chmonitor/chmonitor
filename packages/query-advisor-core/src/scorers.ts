/**
 * Query advisor — pure scorers.
 *
 * Each scorer takes an already-gathered `QueryContext` and returns a
 * `Recommendation` (or `null`/`[]` when its trigger condition doesn't apply).
 * No I/O, fully unit-testable with fixtures.
 *
 * ABSOLUTE INVARIANT: recommend-only. Every scorer returns inert data
 * (strings + numbers); the DDL and rewritten SQL they produce is text for a
 * human to review, and nothing in this package ever executes it.
 */

import type {
  EstimatedImpact,
  PrewhereRewrite,
  QueryContext,
  Recommendation,
  SqlPredicate,
} from './types'

import { summarizeImpact } from './impact'
import {
  findWhereSpan,
  formatQualifiedTable,
  quoteIdentifier,
  splitTopLevelAnd,
} from './sql-parsing'
import { EFFORT_ORDER, RISK_ORDER } from './types'

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
// PREWHERE rewrite — the one "no DDL" recommendation: a read-only text
// transform the user reviews and runs themselves.
// ---------------------------------------------------------------------------

/** Pick the best PREWHERE candidate: prefer equality/IN (typically most selective) on a below-average-size column; fall back to any predicate. */
export function pickPrewhereCandidate(ctx: QueryContext): SqlPredicate | null {
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

/**
 * Propose moving the most selective/cheap WHERE predicate into PREWHERE.
 * Returns `null` when there's no WHERE clause to rewrite, no predicate the
 * engine recognizes, or the WHERE body can't be confidently segmented (e.g.
 * a single complex boolean expression) — never guesses at a rewrite it isn't
 * confident produces equivalent, valid SQL.
 */
export function proposePrewhereRewrite(
  ctx: QueryContext
): PrewhereRewrite | null {
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

/** Wrap a proposed PREWHERE rewrite (plus its measured impact) as a `Recommendation`. */
export function buildPrewhereRecommendation(
  rewrite: PrewhereRewrite,
  estImpact: EstimatedImpact
): Recommendation {
  return {
    kind: 'prewhere',
    title: `Move \`${rewrite.movedPredicate.column}\` into PREWHERE`,
    rationale: `\`${rewrite.movedPredicate.column}\` is a selective WHERE condition; evaluating it in PREWHERE filters rows before ClickHouse reads the remaining (wider) columns.`,
    ddl: null,
    rewrittenSql: rewrite.rewrittenSql,
    risk: 'low',
    riskNote:
      'PREWHERE does not change query semantics for a normal single-table SELECT. Double-check results still match if the query uses FINAL, replicated deduplication, or non-deterministic functions in the moved condition.',
    effort: 'low',
    estImpact,
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
