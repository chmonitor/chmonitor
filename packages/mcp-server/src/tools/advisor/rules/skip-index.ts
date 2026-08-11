/**
 * Skip-index scoring rule for the query advisor (see `../../advisor.ts`
 * header for the duplication note this whole `advisor/` tree inherits).
 */

import type { QueryContext, Recommendation } from '../types'

import { summarizeImpact } from '../impact'
import { formatQualifiedTable, quoteIdentifier } from '../sql-parse'

const DEFAULT_GRANULARITY = 4

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
