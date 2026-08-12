/**
 * DDL text + risk-note building for the MV/projection designer. Pure string
 * building — the result is returned as data, never passed to a
 * query-execution call.
 *
 * See `./index.ts` for the module overview.
 */

import {
  formatQualifiedTable,
  quoteIdentifier,
} from '@/lib/ai/agent/tools/sql-analysis'

import type { AggregateCall, Design, DesignKind } from './index'

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
