import type { DeclarativeQueryConfig } from '../../schema'

// Mirrors explorerTablesConfig (TS): only name/engine/total_rows are rendered,
// so total_bytes / readable_size are no longer selected. Keep in lockstep with
// the TS config — enforced by explorer-catalog.test.ts.
export const explorerTablesDeclarative: DeclarativeQueryConfig = {
  name: 'explorer-tables',
  description: 'List of tables in a database',
  sql: "SELECT name, engine, total_rows FROM system.tables WHERE database = {database:String} AND is_temporary = 0 AND name NOT LIKE '.inner_%' ORDER BY name",
  columns: ['name', 'engine', 'total_rows'],
  optional: false,
  defaultParams: { database: 'default' },
}
