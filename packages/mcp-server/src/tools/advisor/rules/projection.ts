/**
 * Projection scoring rule for the query advisor (see `../../advisor.ts`
 * header for the duplication note this whole `advisor/` tree inherits).
 */

import type { QueryContext, Recommendation } from '../types'

import { summarizeImpact } from '../impact'
import { formatQualifiedTable, quoteIdentifier } from '../sql-parse'

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
