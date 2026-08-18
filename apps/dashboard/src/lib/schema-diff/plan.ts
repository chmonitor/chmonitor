import { tableKey } from './catalog'
import type {
  PlanItem,
  SchemaChangePlan,
  SchemaColumn,
  SchemaDiffResult,
  SchemaIndex,
  SchemaProjection,
  TableSchema,
} from './types'

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

function mapByName<T extends { name: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]))
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

function planForChangedTable(source: TableSchema, target: TableSchema): PlanItem[] {
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

  const sourceCols = mapByName(source.columns)
  const targetCols = mapByName(target.columns)

  for (const [name, col] of sourceCols) {
    const existing = targetCols.get(name)
    if (!existing) {
      items.push({
        id: `add-col:${key}:${name}`,
        tableKey: key,
        kind: 'add_column',
        risk: 'lightweight',
        statement: addColumnStatement(source, col),
        summary: `Add column ${name} (${col.type})`,
        safe: true,
      })
      continue
    }
    if (col.type !== existing.type || col.codec !== existing.codec) {
      items.push({
        id: `mod-col:${key}:${name}`,
        tableKey: key,
        kind: 'modify_column',
        risk: 'mutation',
        statement: modifyColumnStatement(source, col),
        summary: `Modify column ${name} (${existing.type} → ${col.type})`,
        safe: false,
      })
    }
  }

  for (const [name] of targetCols) {
    if (!sourceCols.has(name)) {
      items.push({
        id: `drop-col:${key}:${name}`,
        tableKey: key,
        kind: 'manual',
        risk: 'rewrite',
        statement: '',
        summary: `Column ${name} exists only on the target. Dropping it is destructive — review manually.`,
        safe: false,
      })
    }
  }

  const sourceIdx = mapByName(source.indexes)
  const targetIdx = mapByName(target.indexes)
  for (const [name, idx] of sourceIdx) {
    if (!targetIdx.has(name)) {
      items.push({
        id: `add-idx:${key}:${name}`,
        tableKey: key,
        kind: 'add_index',
        risk: 'mutation',
        statement: addIndexStatement(source, idx),
        summary: `Add index ${name}`,
        safe: true,
      })
    }
  }
  for (const [name] of targetIdx) {
    if (!sourceIdx.has(name)) {
      items.push({
        id: `drop-idx:${key}:${name}`,
        tableKey: key,
        kind: 'manual',
        risk: 'rewrite',
        statement: '',
        summary: `Index ${name} exists only on the target. Dropping it is destructive — review manually.`,
        safe: false,
      })
    }
  }

  const sourceProj = mapByName(source.projections)
  const targetProj = mapByName(target.projections)
  for (const [name, proj] of sourceProj) {
    if (targetProj.has(name)) continue
    const statement = addProjectionStatement(source, proj)
    if (statement) {
      items.push({
        id: `add-proj:${key}:${name}`,
        tableKey: key,
        kind: 'add_projection',
        risk: 'mutation',
        statement,
        summary: `Add projection ${name}`,
        safe: true,
      })
    } else {
      items.push({
        id: `add-proj:${key}:${name}`,
        tableKey: key,
        kind: 'manual',
        risk: 'rewrite',
        statement: '',
        summary: `Projection ${name} is missing on the target. Copy its definition from the source DDL.`,
        safe: false,
      })
    }
  }

  return items
}

export function buildChangePlan(diff: SchemaDiffResult): SchemaChangePlan {
  const items: PlanItem[] = []

  for (const row of diff.onlySource) {
    if (row.source) items.push(...planForMissingTable(row.source))
  }

  for (const row of diff.changed) {
    if (row.source && row.target) {
      items.push(...planForChangedTable(row.source, row.target))
    }
  }

  const safeStatements = items
    .filter((item) => item.safe && item.statement)
    .map((item) => item.statement)

  return { items, safeStatements }
}
