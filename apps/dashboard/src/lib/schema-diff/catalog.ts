import type {
  ColumnRow,
  IndexRow,
  ProjectionRow,
  SchemaCatalog,
  TableRow,
  TableSchema,
} from './types'

export function tableKey(database: string, table: string): string {
  return `${database}.${table}`
}

export function assembleCatalog(
  tables: TableRow[],
  columns: ColumnRow[],
  indexes: IndexRow[] = [],
  projections: ProjectionRow[] = []
): SchemaCatalog {
  const byKey = new Map<string, TableSchema>()

  for (const row of tables) {
    const key = tableKey(row.database, row.table)
    byKey.set(key, {
      database: row.database,
      table: row.table,
      engine: row.engine ?? '',
      sortingKey: row.sorting_key ?? '',
      partitionKey: row.partition_key ?? '',
      primaryKey: row.primary_key ?? '',
      createTableQuery: row.create_table_query ?? '',
      columns: [],
      indexes: [],
      projections: [],
    })
  }

  for (const col of columns) {
    const table = byKey.get(tableKey(col.database, col.table))
    if (!table) continue
    table.columns.push({
      name: col.name,
      type: col.type ?? '',
      codec: col.codec ?? '',
    })
  }

  for (const idx of indexes) {
    const table = byKey.get(tableKey(idx.database, idx.table))
    if (!table) continue
    table.indexes.push({
      name: idx.name,
      type: idx.type ?? '',
      expr: idx.expr ?? '',
      granularity: String(idx.granularity ?? ''),
    })
  }

  for (const proj of projections) {
    const table = byKey.get(tableKey(proj.database, proj.table))
    if (!table) continue
    table.projections.push({
      name: proj.name,
      type: proj.type ?? '',
      query: proj.query ?? '',
    })
  }

  return {
    tables: [...byKey.values()].sort((a, b) =>
      tableKey(a.database, a.table).localeCompare(tableKey(b.database, b.table))
    ),
  }
}
