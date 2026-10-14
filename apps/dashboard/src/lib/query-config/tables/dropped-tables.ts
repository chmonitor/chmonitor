import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const droppedTablesConfig: QueryConfig = {
  name: 'dropped-tables',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['engine'] },
  refreshInterval: 30_000,
  description:
    'Tables awaiting final asynchronous drop (Atomic database engine)',
  optional: true,
  tableCheck: 'system.dropped_tables',
  sql: `SELECT index, database, table, uuid, engine, metadata_dropped_path, table_dropped_time FROM system.dropped_tables ORDER BY table_dropped_time DESC`,
  columns: [
    'index',
    'database',
    'table',
    'uuid',
    'engine',
    'metadata_dropped_path',
    'table_dropped_time',
  ],
  columnFormats: {
    database: ColumnFormat.ColoredBadge,
    table: ColumnFormat.ColoredBadge,
    engine: ColumnFormat.ColoredBadge,
    table_dropped_time: ColumnFormat.RelatedTime,
  },
}
