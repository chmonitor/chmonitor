import type { DeclarativeQueryConfig } from '../../schema'

export const detachedPartsDeclarative: DeclarativeQueryConfig = {
  name: 'detached_parts',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['reason'] },
  description: `Contains information about detached parts of MergeTree tables. The reason column specifies why the part was detached`,
  optional: false,
  tableCheck: 'system.detached_parts',
  sql: `
      SELECT * EXCEPT (table),
             format('{}.{}', dp.database, dp.table) AS table,
             formatReadableSize(bytes_on_disk) AS readable_bytes_on_disk
      FROM system.detached_parts AS dp
      -- \`{table:String}\` is database-qualified ('db.name') or empty for "everything".
      -- An unqualified \`table\` here resolves to the SELECT alias (a qualified name),
      -- so both operands stay explicit columns.
      WHERE ({table:String} = '' OR concat(dp.database, '.', dp.table) = {table:String})
      ORDER BY table, name
  `,
  columns: [
    'table',
    'partition_id',
    'name',
    'readable_bytes_on_disk',
    'modification_time',
    'disk',
    'path',
    'reason',
    'level',
    'min_block_number',
    'max_block_number',
  ],
  columnFormats: {},
  defaultParams: {
    table: '',
  },
  relatedCharts: [],
}
