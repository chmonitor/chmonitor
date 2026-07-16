import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/**
 * Per-table ingestion over the last 24h (system.part_log NewPart events),
 * joined with the table's overall compression ratio from system.parts.
 * part_log is opt-in, so the whole view is optional.
 */
export const trafficPerTableConfig: QueryConfig = {
  name: 'traffic-per-table',
  description:
    'Tables ranked by data ingested in the last 24 hours: rows, on-disk bytes, parts created, and overall compression ratio',
  optional: true,
  tableCheck: 'system.part_log',
  sql: `
      SELECT
        table,
        rows_added,
        formatReadableQuantity(rows_added) AS readable_rows_added,
        round(rows_added * 100.0 / nullIf(max(rows_added) OVER (), 0), 2) AS pct_rows_added,
        bytes_added,
        formatReadableSize(bytes_added) AS readable_bytes_added,
        round(bytes_added * 100.0 / nullIf(max(bytes_added) OVER (), 0), 2) AS pct_bytes_added,
        parts_created,
        formatReadableQuantity(parts_created) AS readable_parts_created,
        round(parts_created * 100.0 / nullIf(max(parts_created) OVER (), 0), 2) AS pct_parts_created,
        round(uncompressed / nullIf(compressed, 0), 2) AS compression_ratio
      FROM (
        SELECT
          database || '.' || table AS table,
          sum(rows) AS rows_added,
          sum(size_in_bytes) AS bytes_added,
          count() AS parts_created
        FROM system.part_log
        WHERE event_type = 'NewPart'
          AND event_time >= now() - INTERVAL 24 HOUR
        GROUP BY 1
      ) AS ingest
      LEFT JOIN (
        SELECT
          database || '.' || table AS table,
          sum(data_compressed_bytes) AS compressed,
          sum(data_uncompressed_bytes) AS uncompressed
        FROM system.parts
        WHERE active
        GROUP BY 1
      ) AS parts USING (table)
      ORDER BY bytes_added DESC
      LIMIT 100
    `,
  columns: [
    'table',
    'readable_rows_added',
    'readable_bytes_added',
    'readable_parts_created',
    'compression_ratio',
  ],
  columnFormats: {
    table: ColumnFormat.ColoredBadge,
    readable_rows_added: ColumnFormat.BackgroundBar,
    readable_bytes_added: ColumnFormat.BackgroundBar,
    readable_parts_created: ColumnFormat.BackgroundBar,
    compression_ratio: ColumnFormat.Number,
  },
}
