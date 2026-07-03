import type { QueryConfig } from '@/types/query-config'

// Sidebar tree (and the SQL-console table picker) consume only name, engine and
// total_rows. total_bytes / readable_size were selected but never rendered, so
// they are dropped to keep this per-database system.tables read as light as the
// sidebar needs. total_rows stays: it drives the row-count badge in the tree.
export const explorerTablesConfig: QueryConfig = {
  name: 'explorer-tables',
  description: 'List of tables in a database',
  sql: `SELECT name, engine, total_rows FROM system.tables WHERE database = {database:String} AND is_temporary = 0 AND name NOT LIKE '.inner_%' ORDER BY name`,
  columns: ['name', 'engine', 'total_rows'],
  defaultParams: { database: 'default' },
}
