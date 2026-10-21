import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/**
 * Flags projections with zero rows as candidates for removal.
 */
export const projectionAnalyticsConfig: QueryConfig = {
  name: 'projection-analytics',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['database', 'table', 'projection_name'] },
  description:
    'Projection inventory: storage cost and row count per table (system.projection_parts). Flag empty/dead projections.',
  refreshInterval: 60_000,
  sql: `
    SELECT
      database,
      table,
      name AS projection_name,
      count() AS parts,
      sum(data_compressed_bytes) AS total_compressed_bytes,
      formatReadableSize(sum(data_compressed_bytes)) AS readable_compressed,
      round(sum(data_compressed_bytes) * 100.0 / nullIf(max(sum(data_compressed_bytes)) OVER (), 0), 2) AS pct_compressed,
      formatReadableSize(sum(data_uncompressed_bytes)) AS readable_uncompressed,
      round(
        if(sum(data_compressed_bytes) > 0,
          sum(data_uncompressed_bytes) / sum(data_compressed_bytes),
          0),
        2
      ) AS compression_ratio,
      formatReadableQuantity(sum(rows)) AS readable_rows,
      sum(rows) AS total_rows,
      if(sum(rows) = 0, 'empty', 'active') AS status
    FROM system.projection_parts
    WHERE active
    GROUP BY database, table, projection_name
    ORDER BY total_compressed_bytes DESC
    LIMIT 1000
  `,
  columns: [
    'database',
    'table',
    'projection_name',
    'parts',
    'readable_compressed',
    'readable_uncompressed',
    'compression_ratio',
    'readable_rows',
    'status',
  ],
  columnFormats: {
    database: ColumnFormat.ColoredBadge,
    table: ColumnFormat.ColoredBadge,
    projection_name: ColumnFormat.ColoredBadge,
    readable_compressed: ColumnFormat.BackgroundBar,
    compression_ratio: ColumnFormat.NumberShort,
    status: ColumnFormat.ColoredBadge,
  },
  rowClassName: (row) => {
    if (row.status === 'empty') return 'opacity-60'
    return ''
  },
}
