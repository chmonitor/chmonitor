import type { DeclarativeQueryConfig } from '../../schema'

export const databaseTableColumnsDeclarative: DeclarativeQueryConfig = {
  name: 'columns',
  defaultView: 'auto',
  card: { primary: 'column', badges: ['type'] },
  sql: `
    WITH columns AS (
      SELECT database,
             table,
             name as column,
             type,
             compression_codec as codec,
             (default_kind || ' ' || default_expression) as default_expression,
             comment
      FROM system.columns
      WHERE (database = {database: String})
        AND (table = {table: String})
    ),
    summary AS (
      SELECT database,
             table,
             column,
             type,
             sum(column_data_compressed_bytes) as compressed,
             sum(column_data_uncompressed_bytes) AS uncompressed,
             formatReadableSize(compressed) AS readable_compressed,
             formatReadableSize(uncompressed) AS readable_uncompressed,
             round(uncompressed / compressed, 2) AS compr_ratio,
             sum(rows) AS rows_cnt,
             formatReadableQuantity(rows_cnt) AS readable_rows_cnt,
             round(uncompressed / rows_cnt, 2) avg_row_size,
             round(100 * compressed / nullIf(max(compressed) OVER (), 0)) AS pct_compressed,
             round(100 * uncompressed / nullIf(max(uncompressed) OVER(), 0)) AS pct_uncompressed,
             round(100 * rows_cnt / nullIf(max(rows_cnt) OVER (), 0)) AS pct_rows_cnt,
             round(100 * compr_ratio / nullIf(max(compr_ratio) OVER (), 0)) AS pct_compr_ratio
      FROM system.parts_columns
      WHERE (active = 1)
        AND (database = {database: String})
        AND (table = {table: String})
      GROUP BY database,
               table,
               column,
               type
      ORDER BY compressed DESC
    )
    SELECT
      c.column,
      c.type,
      coalesce(s.readable_compressed, '0 B') as readable_compressed,
      coalesce(s.readable_uncompressed, '0 B') as readable_uncompressed,
      coalesce(s.compr_ratio, 0) as compr_ratio,
      coalesce(s.readable_rows_cnt, '0') as readable_rows_cnt,
      coalesce(s.avg_row_size, 0) as avg_row_size,
      c.codec,
      c.default_expression,
      c.comment
    FROM columns c
    LEFT OUTER JOIN summary s USING (database, table, column)
    ORDER BY c.column
  `,
  columns: [
    'column',
    'type',
    'readable_compressed',
    'readable_uncompressed',
    'compr_ratio',
    'readable_rows_cnt',
    'avg_row_size',
    'codec',
    'comment',
  ],
  columnFormats: {
    column: ['hover-card', { content: 'Column comment: [comment]' }],
    type: 'code',
    codec: 'code',
    part_count: 'number',
    readable_compressed: 'background-bar',
    readable_uncompressed: 'background-bar',
    compr_ratio: 'background-bar',
    readable_rows_cnt: 'background-bar',
    default_expression: 'code',
  },
  optional: false,
}

export const tablesListDeclarative: DeclarativeQueryConfig = {
  name: 'tables-list',
  description: 'List of tables in a database',
  sql: `
    WITH detached_parts AS (
        SELECT
            database,
            table,
            count() AS detached_parts_count,
            sum(bytes_on_disk) AS detached_bytes_on_disk,
            formatReadableSize(sum(bytes_on_disk)) AS readable_detached_bytes_on_disk
        FROM system.detached_parts
        WHERE database = {database:String}
        GROUP BY database, table
    )
    SELECT
        database,
        table,
        engine,
        sum(bytes_on_disk) as compressed,
        formatReadableSize(compressed) as readable_compressed,
        sum(data_uncompressed_bytes) as uncompressed,
        formatReadableSize(uncompressed) as readable_uncompressed,
        round(compressed / uncompressed, 2) as compr_rate,
        sum(rows) as total_rows,
        formatReadableQuantity(total_rows) as readable_total_rows,
        sum(bytes_on_disk) / sum(rows) as avg_part_size,
        formatReadableSize(avg_part_size) as readable_avg_part_size,
        count() as parts_count,
        coalesce(dp.detached_parts_count, 0) as detached_parts_count,
        coalesce(dp.readable_detached_bytes_on_disk, '0 B') as readable_detached_bytes_on_disk
    FROM system.parts
    LEFT JOIN detached_parts dp USING (database, table)
    WHERE active
        AND database = {database:String}
    GROUP BY database, table, engine, dp.detached_parts_count, dp.readable_detached_bytes_on_disk
    ORDER BY compressed DESC
  `,
  columns: [
    'database',
    'table',
    'engine',
    'readable_compressed',
    'readable_uncompressed',
    'compr_rate',
    'readable_total_rows',
    'readable_avg_part_size',
    'parts_count',
    'detached_parts_count',
    'readable_detached_bytes_on_disk',
    'action',
  ],
  columnFormats: {
    parts_count: 'number',
    detached_parts_count: 'link',
    table: [
      'link',
      {
        href: `/table?host=[ctx.hostId]&database=[ctx.database]&table=[table]`,
        className: 'truncate max-w-48',
      },
    ],
    engine: ['colored-badge', { className: 'truncate max-w-40' }],
    readable_compressed: 'background-bar',
    readable_uncompressed: 'background-bar',
    readable_total_rows: 'background-bar',
    readable_avg_part_size: 'background-bar',
    compr_rate: 'background-bar',
    comment: [
      'text',
      {
        className: 'line-clamp-1	hover:text-nowrap',
      },
    ],
    action: ['action', ['optimize']],
  },
  defaultParams: {
    database: '',
  },
  optional: false,
}
