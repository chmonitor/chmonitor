import type { QueryConfig } from '@/types/query-config'

// Sidebar tree + empty-state gate. Deliberately does NOT join system.tables:
// the tree renders only `name` and the empty-state renders `name` + `engine`,
// so enumerating every table in the cluster to compute a per-database count
// (the old `LEFT JOIN system.tables ... GROUP BY`) blocked the first paint for
// a number nothing on this path uses. Table counts are now a separate,
// streamed query (`explorer-database-counts`) consumed only by the empty-state.
export const explorerDatabasesConfig: QueryConfig = {
  name: 'explorer-databases',
  description: 'List of ClickHouse databases',
  sql: `
    SELECT name, engine
    FROM system.databases
    WHERE name NOT IN ('INFORMATION_SCHEMA', 'information_schema')
    ORDER BY name
  `,
  columns: ['name', 'engine'],
}

// Per-database table counts for the explorer empty-state, split out of
// `explorer-databases` so the sidebar/first paint never waits on a
// system.tables enumeration. Streamed in after the database names render.
export const explorerDatabaseCountsConfig: QueryConfig = {
  name: 'explorer-database-counts',
  description: 'Per-database table counts for the explorer empty-state',
  sql: `
    SELECT database AS name, count() AS item_count
    FROM system.tables
    WHERE database NOT IN ('INFORMATION_SCHEMA', 'information_schema')
    GROUP BY database
  `,
  columns: ['name', 'item_count'],
}
