export type SchemaColumn = {
  name: string
  type: string
  codec: string
}

export type SchemaIndex = {
  name: string
  type: string
  expr: string
  granularity: string
}

export type SchemaProjection = {
  name: string
  type: string
  query: string
}

export type TableSchema = {
  database: string
  table: string
  engine: string
  sortingKey: string
  partitionKey: string
  primaryKey: string
  createTableQuery: string
  columns: SchemaColumn[]
  indexes: SchemaIndex[]
  projections: SchemaProjection[]
}

export type TableRow = {
  database: string
  table: string
  engine: string
  sorting_key: string
  partition_key: string
  primary_key: string
  create_table_query: string
}

export type ColumnRow = {
  database: string
  table: string
  name: string
  type: string
  codec: string
}

export type IndexRow = {
  database: string
  table: string
  name: string
  type: string
  expr: string
  granularity: string
}

export type ProjectionRow = {
  database: string
  table: string
  name: string
  type: string
  query: string
}

export type SchemaCatalog = {
  tables: TableSchema[]
}

export type TableDiffKind =
  | 'only_source'
  | 'only_target'
  | 'changed'
  | 'identical'

export type FieldChange = {
  field: string
  source: string
  target: string
}

export type TableDiff = {
  key: string
  kind: TableDiffKind
  source?: TableSchema
  target?: TableSchema
  changes: FieldChange[]
}

export type SchemaDiffResult = {
  onlySource: TableDiff[]
  onlyTarget: TableDiff[]
  changed: TableDiff[]
  identical: TableDiff[]
}

export type PlanRisk = 'lightweight' | 'mutation' | 'rewrite'

export type PlanItemKind =
  | 'create_table'
  | 'add_column'
  | 'modify_column'
  | 'add_index'
  | 'add_projection'
  | 'manual'

export type PlanItem = {
  id: string
  tableKey: string
  kind: PlanItemKind
  risk: PlanRisk
  /** Recommended statement, or empty when the item is a manual note. */
  statement: string
  summary: string
  safe: boolean
}

export type SchemaChangePlan = {
  items: PlanItem[]
  safeStatements: string[]
}

export type SchemaDiffHostInfo = { id: number; name: string }

export type SchemaDiffScope = 'hosts' | 'nodes'

export type SchemaDiffResponse = {
  success: boolean
  hosts: SchemaDiffHostInfo[]
  nodes: SchemaDiffHostInfo[]
  scope: SchemaDiffScope
  sourceHostId: number | null
  targetHostId: number | null
  diff: SchemaDiffResult
  plan: SchemaChangePlan
  error?: string
  unavailable?: { reason: string; message: string }
}
