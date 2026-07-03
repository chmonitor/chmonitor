import type { DeclarativeQueryConfig } from '../../schema'

// Mirrors explorerDatabasesConfig (TS). Table counts moved to a separate
// streamed query (explorer-database-counts) so the sidebar / first paint no
// longer joins system.tables. Keep this in lockstep with the TS config —
// enforced by explorer-catalog.test.ts.
export const explorerDatabasesDeclarative: DeclarativeQueryConfig = {
  name: 'explorer-databases',
  description: 'List of ClickHouse databases',
  sql: `
    SELECT name, engine
    FROM system.databases
    WHERE name NOT IN ('INFORMATION_SCHEMA', 'information_schema')
    ORDER BY name
  `,
  columns: ['name', 'engine'],
  optional: false,
}
