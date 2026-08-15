import type { QueryConfig } from '@/types/query-config'

export const detachedPartsConfig: QueryConfig = {
  name: 'detached_parts',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['reason'] },
  description: `Contains information about detached parts of MergeTree tables. The reason column specifies why the part was detached`,
  tableCheck: 'system.detached_parts',
  sql: `
      SELECT * EXCEPT (table),
             format('{}.{}', database, table) AS table,
             formatReadableSize(bytes_on_disk) AS readable_bytes_on_disk
      FROM system.detached_parts
      WHERE table = {table:String}
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
    table: 'default.default',
  },
  relatedCharts: [],
}
