/**
 * Partition-key scoring rule for the query advisor (see `../../advisor.ts`
 * header for the duplication note this whole `advisor/` tree inherits).
 */

import type { QueryContext, Recommendation } from '../types'

import { summarizeImpact } from '../impact'
import { formatQualifiedTable, quoteIdentifier } from '../sql-parse'

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
