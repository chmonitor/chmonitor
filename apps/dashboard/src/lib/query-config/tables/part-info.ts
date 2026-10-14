import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const partInfoConfig: QueryConfig = {
  name: 'part-info',
  defaultView: 'auto',
  card: { primary: 'name', badges: ['partition'] },
  description:
    'Information about currently active parts and levels for a table',

  // Note: 'marks' is the correct column (NOT 'marks_count')
  sql: [
    {
      since: '19.1',
      description: 'Base query - primary_key_bytes_in_memory not available',
      sql: `
        WITH parts_data AS (
          SELECT
            *,
            round(data_uncompressed_bytes / nullIf(data_compressed_bytes, 0), 2) AS compression_ratio
          FROM system.parts
          WHERE database = {database: String}
            AND table = {table: String}
            AND active = 1
        )
        SELECT
          name,
          partition,
          level,
          round(level * 100.0 / nullIf(max(level) OVER (), 0), 2) AS pct_level,
          rows,
          formatReadableQuantity(rows) as readable_rows,
          round(rows * 100.0 / nullIf(max(rows) OVER (), 0), 2) AS pct_rows,
          data_compressed_bytes,
          formatReadableSize(data_compressed_bytes) AS readable_compressed,
          round(data_compressed_bytes * 100.0 / nullIf(max(data_compressed_bytes) OVER (), 0), 2) AS pct_compressed,
          data_uncompressed_bytes,
          formatReadableSize(data_uncompressed_bytes) AS readable_uncompressed,
          round(data_uncompressed_bytes * 100.0 / nullIf(max(data_uncompressed_bytes) OVER (), 0), 2) AS pct_uncompressed,
          compression_ratio,
          round(compression_ratio * 100.0 / nullIf(max(compression_ratio) OVER (), 0), 2) AS pct_compression_ratio,
          marks,
          0 AS primary_key_bytes_in_memory,
          '-' AS readable_primary_key_size,
          0 AS pct_primary_key_size,
          modification_time,
          min_date,
          max_date,
          disk_name,
          path,
          toUInt64(0) AS files_count,
          '0' AS readable_files_count,
          toFloat64(0) AS pct_files_count
        FROM parts_data
        ORDER BY name ASC
      `,
    },
    {
      since: '21.8',
      description: 'Includes primary_key_bytes_in_memory columns',
      sql: `
        WITH parts_data AS (
          SELECT
            *,
            round(data_uncompressed_bytes / nullIf(data_compressed_bytes, 0), 2) AS compression_ratio
          FROM system.parts
          WHERE database = {database: String}
            AND table = {table: String}
            AND active = 1
        )
        SELECT
          name,
          partition,
          level,
          round(level * 100.0 / nullIf(max(level) OVER (), 0), 2) AS pct_level,
          rows,
          formatReadableQuantity(rows) as readable_rows,
          round(rows * 100.0 / nullIf(max(rows) OVER (), 0), 2) AS pct_rows,
          data_compressed_bytes,
          formatReadableSize(data_compressed_bytes) AS readable_compressed,
          round(data_compressed_bytes * 100.0 / nullIf(max(data_compressed_bytes) OVER (), 0), 2) AS pct_compressed,
          data_uncompressed_bytes,
          formatReadableSize(data_uncompressed_bytes) AS readable_uncompressed,
          round(data_uncompressed_bytes * 100.0 / nullIf(max(data_uncompressed_bytes) OVER (), 0), 2) AS pct_uncompressed,
          compression_ratio,
          round(compression_ratio * 100.0 / nullIf(max(compression_ratio) OVER (), 0), 2) AS pct_compression_ratio,
          marks,
          primary_key_bytes_in_memory,
          formatReadableSize(primary_key_bytes_in_memory) AS readable_primary_key_size,
          round(primary_key_bytes_in_memory * 100.0 / nullIf(max(primary_key_bytes_in_memory) OVER (), 0), 2) AS pct_primary_key_size,
          modification_time,
          min_date,
          max_date,
          disk_name,
          path,
          toUInt64(0) AS files_count,
          '0' AS readable_files_count,
          toFloat64(0) AS pct_files_count
        FROM parts_data
        ORDER BY name ASC
      `,
    },
    {
      since: '26.1',
      description:
        'Includes files column: number of files per part (high count may indicate fragmentation)',
      sql: `
        WITH parts_data AS (
          SELECT
            *,
            round(data_uncompressed_bytes / nullIf(data_compressed_bytes, 0), 2) AS compression_ratio
          FROM system.parts
          WHERE database = {database: String}
            AND table = {table: String}
            AND active = 1
        )
        SELECT
          name,
          partition,
          level,
          round(level * 100.0 / nullIf(max(level) OVER (), 0), 2) AS pct_level,
          rows,
          formatReadableQuantity(rows) as readable_rows,
          round(rows * 100.0 / nullIf(max(rows) OVER (), 0), 2) AS pct_rows,
          data_compressed_bytes,
          formatReadableSize(data_compressed_bytes) AS readable_compressed,
          round(data_compressed_bytes * 100.0 / nullIf(max(data_compressed_bytes) OVER (), 0), 2) AS pct_compressed,
          data_uncompressed_bytes,
          formatReadableSize(data_uncompressed_bytes) AS readable_uncompressed,
          round(data_uncompressed_bytes * 100.0 / nullIf(max(data_uncompressed_bytes) OVER (), 0), 2) AS pct_uncompressed,
          compression_ratio,
          round(compression_ratio * 100.0 / nullIf(max(compression_ratio) OVER (), 0), 2) AS pct_compression_ratio,
          marks,
          primary_key_bytes_in_memory,
          formatReadableSize(primary_key_bytes_in_memory) AS readable_primary_key_size,
          round(primary_key_bytes_in_memory * 100.0 / nullIf(max(primary_key_bytes_in_memory) OVER (), 0), 2) AS pct_primary_key_size,
          modification_time,
          min_date,
          max_date,
          disk_name,
          path,
          length(files) AS files_count,
          formatReadableQuantity(files_count) AS readable_files_count,
          round(files_count * 100.0 / nullIf(max(files_count) OVER (), 0), 2) AS pct_files_count
        FROM parts_data
        ORDER BY name ASC
      `,
    },
  ],

  columns: [
    'name',
    'partition',
    'level',
    'readable_rows',
    'readable_compressed',
    'readable_uncompressed',
    'compression_ratio',
    'marks',
    'readable_primary_key_size',
    'readable_files_count',
    'modification_time',
    'min_date',
    'max_date',
    'disk_name',
  ],
  columnFormats: {
    name: ColumnFormat.Code,
    partition: ColumnFormat.Code,
    level: ColumnFormat.BackgroundBar,
    readable_rows: ColumnFormat.BackgroundBar,
    readable_compressed: ColumnFormat.BackgroundBar,
    readable_uncompressed: ColumnFormat.BackgroundBar,
    compression_ratio: ColumnFormat.BackgroundBar,
    marks: ColumnFormat.Number,
    readable_primary_key_size: ColumnFormat.BackgroundBar,
    // CH 26.1+: number of files per part; high values may indicate fragmentation
    readable_files_count: ColumnFormat.BackgroundBar,
    modification_time: ColumnFormat.RelatedTime,
    disk_name: ColumnFormat.ColoredBadge,
  },
  sortingFns: {
    readable_rows: 'sort_column_using_actual_value',
    readable_compressed: 'sort_column_using_actual_value',
    readable_uncompressed: 'sort_column_using_actual_value',
  },
  defaultParams: {
    database: 'default',
    table: '',
  },
}
