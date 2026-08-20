import type {
  PlanItem,
  SchemaChangePlan,
  SchemaColumn,
  SchemaDiffResult,
  SchemaIndex,
  SchemaProjection,
  TableSchema,
} from './types'

import { tableKey } from './catalog'
import { namedDelta } from './named-delta'
import {
  annotateDdlForTopology,
  type ClusterTopology,
  topologyFromDistributedTable,
} from '@/lib/ddl/on-cluster'

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function qualifiedTable(table: TableSchema): string {
  return `${quoteIdent(table.database)}.${quoteIdent(table.table)}`
}

function columnSuffix(col: SchemaColumn): string {
  return col.codec ? ` ${col.codec}` : ''
}

function addColumnStatement(table: TableSchema, col: SchemaColumn): string {
  return `ALTER TABLE ${qualifiedTable(table)} ADD COLUMN ${quoteIdent(col.name)} ${col.type}${columnSuffix(col)}`
}

function modifyColumnStatement(table: TableSchema, col: SchemaColumn): string {
  return `ALTER TABLE ${qualifiedTable(table)} MODIFY COLUMN ${quoteIdent(col.name)} ${col.type}${columnSuffix(col)}`
}

function addIndexStatement(table: TableSchema, idx: SchemaIndex): string {
  const gran = idx.granularity ? ` GRANULARITY ${idx.granularity}` : ''
  return `ALTER TABLE ${qualifiedTable(table)} ADD INDEX ${quoteIdent(idx.name)} ${idx.expr} TYPE ${idx.type}${gran}`
}

function addProjectionStatement(
  table: TableSchema,
  proj: SchemaProjection
): string | null {
  if (!proj.query) return null
  return `ALTER TABLE ${qualifiedTable(table)} ADD PROJECTION ${quoteIdent(proj.name)} (${proj.query})`
}

function planForMissingTable(source: TableSchema): PlanItem[] {
  const statement = source.createTableQuery.trim()
  return [
    {
      id: `create:${tableKey(source.database, source.table)}`,
      tableKey: tableKey(source.database, source.table),
      kind: 'create_table',
      risk: 'lightweight',
      statement,
      summary: `Create ${tableKey(source.database, source.table)} on the target`,
      safe: Boolean(statement),
    },
  ]
}

function planForChangedTable(
  source: TableSchema,
  target: TableSchema
): PlanItem[] {
  const items: PlanItem[] = []
  const key = tableKey(source.database, source.table)

  if (source.engine !== target.engine) {
    items.push({
      id: `engine:${key}`,
      tableKey: key,
      kind: 'manual',
      risk: 'rewrite',
      statement: '',
      summary: `Engine differs (${target.engine || '∅'} → ${source.engine || '∅'}). Do not auto-rewrite; migrate manually.`,
      safe: false,
    })
  }

  if (source.sortingKey !== target.sortingKey) {
    items.push({
      id: `order:${key}`,
      tableKey: key,
      kind: 'manual',
      risk: 'rewrite',
      statement: '',
      summary: `ORDER BY / sorting key differs. Do not auto-rewrite; rebuild the table manually.`,
      safe: false,
    })
  }

  if (source.primaryKey !== target.primaryKey) {
    items.push({
      id: `pk:${key}`,
      tableKey: key,
      kind: 'manual',
      risk: 'rewrite',
      statement: '',
      summary: `Primary key differs. Rebuild the table manually.`,
      safe: false,
    })
  }

  if (source.partitionKey !== target.partitionKey) {
    items.push({
      id: `partition:${key}`,
      tableKey: key,
      kind: 'manual',
      risk: 'rewrite',
      statement: '',
      summary: `Partition key differs. Rebuild the table manually.`,
      safe: false,
    })
  }

  const columns = namedDelta(
    source.columns,
    target.columns,
    (a, b) => a.type === b.type && a.codec === b.codec
  )
  for (const col of columns.added) {
    items.push({
      id: `add-col:${key}:${col.name}`,
      tableKey: key,
      kind: 'add_column',
      risk: 'lightweight',
      statement: addColumnStatement(source, col),
      summary: `Add column ${col.name} (${col.type})`,
      safe: true,
    })
  }
  for (const { name, source: src, target: existing } of columns.changed) {
    items.push({
      id: `mod-col:${key}:${name}`,
      tableKey: key,
      kind: 'modify_column',
      risk: 'mutation',
      statement: modifyColumnStatement(source, src),
      summary: `Modify column ${name} (${existing.type} → ${src.type})`,
      safe: false,
    })
  }
  for (const col of columns.removed) {
    items.push({
      id: `drop-col:${key}:${col.name}`,
      tableKey: key,
      kind: 'manual',
      risk: 'rewrite',
      statement: '',
      summary: `Column ${col.name} exists only on the target. Dropping it is destructive — review manually.`,
      safe: false,
    })
  }

  const indexes = namedDelta(
    source.indexes,
    target.indexes,
    (a, b) =>
      a.type === b.type && a.expr === b.expr && a.granularity === b.granularity
  )
  for (const idx of indexes.added) {
    items.push({
      id: `add-idx:${key}:${idx.name}`,
      tableKey: key,
      kind: 'add_index',
      risk: 'mutation',
      statement: addIndexStatement(source, idx),
      summary: `Add index ${idx.name}`,
      safe: true,
    })
  }
  for (const idx of indexes.removed) {
    items.push({
      id: `drop-idx:${key}:${idx.name}`,
      tableKey: key,
      kind: 'manual',
      risk: 'rewrite',
      statement: '',
      summary: `Index ${idx.name} exists only on the target. Dropping it is destructive — review manually.`,
      safe: false,
    })
  }

  const projections = namedDelta(
    source.projections,
    target.projections,
    (a, b) => a.type === b.type && a.query === b.query
  )
  for (const proj of projections.added) {
    const statement = addProjectionStatement(source, proj)
    if (statement) {
      items.push({
        id: `add-proj:${key}:${proj.name}`,
        tableKey: key,
        kind: 'add_projection',
        risk: 'mutation',
        statement,
        summary: `Add projection ${proj.name}`,
        safe: true,
      })
    } else {
      items.push({
        id: `add-proj:${key}:${proj.name}`,
        tableKey: key,
        kind: 'manual',
        risk: 'rewrite',
        statement: '',
        summary: `Projection ${proj.name} is missing on the target. Copy its definition from the source DDL.`,
        safe: false,
      })
    }
  }

  return items
}

function tableByKey(
  diff: SchemaDiffResult,
  key: string
): TableSchema | undefined {
  for (const row of [...diff.onlySource, ...diff.changed, ...diff.identical]) {
    if (row.key === key) return row.source ?? row.target
  }
  return undefined
}

function topologyForItem(
  item: PlanItem,
  diff: SchemaDiffResult,
  fallback: ClusterTopology
): ClusterTopology {
  const table = tableByKey(diff, item.tableKey)
  const fromDist = table
    ? topologyFromDistributedTable({
        engine: table.engine,
        createTableQuery: table.createTableQuery,
      })
    : null
  if (fromDist) return fromDist
  if (fallback?.cluster && table) {
    return {
      cluster: fallback.cluster,
      localDatabase: table.database,
      localTable: table.table,
    }
  }
  return fallback
}

function annotatePlanItem(item: PlanItem, topology: ClusterTopology): PlanItem {
  if (!item.statement) return item
  const annotated = annotateDdlForTopology(item.statement, topology)
  return {
    ...item,
    statement: annotated.statement,
    localTableName: annotated.localTableName,
    onClusterStatement: annotated.onClusterStatement,
    localOnlyReason: annotated.localOnlyReason,
  }
}

export function buildChangePlan(
  diff: SchemaDiffResult,
  topology: ClusterTopology = null
): SchemaChangePlan {
  const items: PlanItem[] = []

  for (const row of diff.onlySource) {
    if (row.source) items.push(...planForMissingTable(row.source))
  }

  for (const row of diff.changed) {
    if (row.source && row.target) {
      items.push(...planForChangedTable(row.source, row.target))
    }
  }

  const annotated = items.map((item) =>
    annotatePlanItem(item, topologyForItem(item, diff, topology))
  )

  const safeStatements = annotated
    .filter((item) => item.safe && item.statement)
    .map((item) => item.statement)

  return { items: annotated, safeStatements }
}

/**
 * Recommend-only statements for a sync selection.
 * Empty / omitted keys → every safe statement (copy-all).
 */
export function safeStatementsForTables(
  plan: SchemaChangePlan,
  tableKeys?: ReadonlySet<string> | null
): string[] {
  if (!tableKeys || tableKeys.size === 0) return plan.safeStatements
  return plan.items
    .filter(
      (item) => item.safe && item.statement && tableKeys.has(item.tableKey)
    )
    .map((item) => item.statement)
}
