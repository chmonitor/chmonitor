import type { DeclarativeQueryConfig } from '../../schema'

export const tablesOverviewDeclarative: DeclarativeQueryConfig = {
  name: 'tables-overview',
  optional: false,
  defaultView: 'auto',
  card: { primary: 'table', badges: ['engine'] },
  sql: `
      WITH
        detached_parts AS
        (
            SELECT
                format('{}.{}', dp.database, dp.\`table\`) AS \`table\`,
                count() AS detached_parts_count,
                sum(bytes_on_disk) AS detached_bytes_on_disk,
                formatReadableSize(detached_bytes_on_disk) AS readable_detached_bytes_on_disk
            FROM system.detached_parts AS dp
            GROUP BY dp.database, dp.\`table\`
        ),
        parts AS
        (
            SELECT
                format('{}.{}', parts.database, parts.\`table\`) AS \`table\`,
                sum(rows) AS total_rows,
                formatReadableQuantity(total_rows) AS readable_total_rows,
                round((100 * total_rows) / nullIf(max(total_rows) OVER (), 0)) AS pct_total_rows,
                max(modification_time) AS latest_modification,

                sum(data_compressed_bytes) AS compressed,
                sum(data_uncompressed_bytes) AS uncompressed,
                round(uncompressed / nullIf(compressed, 0), 2) AS compr_rate,
                formatReadableSize(compressed) AS readable_compressed,
                formatReadableSize(uncompressed) AS readable_uncompressed,
                round((100 * compressed) / nullIf(max(compressed) OVER (), 0)) AS pct_compressed,
                round((100 * uncompressed) / nullIf(max(uncompressed) OVER (), 0)) AS pct_uncompressed,
                round((100 * compr_rate) / nullIf(max(compr_rate) OVER (), 0)) AS pct_compr_rate,

                avg(data_compressed_bytes) AS avg_part_size_compressed,
                avg(data_uncompressed_bytes) AS avg_part_size_uncompressed,
                formatReadableSize(avg_part_size_compressed) AS readable_avg_part_size_compressed,
                formatReadableSize(avg_part_size_uncompressed) AS readable_avg_part_size_uncompressed,
                round((100 * avg_part_size_compressed) / nullIf(max(avg_part_size_compressed) OVER (), 0)) AS pct_avg_part_size_compressed,
                round((100 * avg_part_size_uncompressed) / nullIf(max(avg_part_size_uncompressed) OVER (), 0)) AS pct_avg_part_size_uncompressed,

                max(data_compressed_bytes) AS max_part_size_compressed,
                max(data_uncompressed_bytes) AS max_part_size_uncompressed,
                formatReadableSize(max_part_size_compressed) AS readable_max_part_size_compressed,
                formatReadableSize(max_part_size_uncompressed) AS readable_max_part_size_uncompressed,
                round((100 * max_part_size_compressed) / nullIf(max(max_part_size_compressed) OVER (), 0)) AS pct_max_part_size_compressed,
                round((100 * max_part_size_uncompressed) / nullIf(max(max_part_size_uncompressed) OVER (), 0)) AS pct_max_part_size_uncompressed,

                sum(primary_key_bytes_in_memory) AS primary_keys_size,
                formatReadableSize(primary_keys_size) AS readable_primary_keys_size,
                round((100 * primary_keys_size) / nullIf(max(primary_keys_size) OVER (), 0)) AS pct_primary_keys_size,
                any(engine) AS engine,
                count() AS parts_count,
                round((100 * parts_count) / nullIf(max(parts_count) OVER (), 0)) AS pct_parts_count
            FROM system.parts AS parts
            WHERE active
            GROUP BY parts.database, parts.\`table\`
        )
      SELECT
        parts.*,
        detached_parts.*,
        splitByChar('.', parts.table)[1] AS _database,
        splitByChar('.', parts.table)[2] AS _table
      FROM parts
      LEFT JOIN detached_parts USING (\`table\`)
      ORDER BY compressed DESC
    `,
  columns: [
    'table',
    'readable_compressed',
    'readable_uncompressed',
    'compr_rate',
    'readable_avg_part_size_compressed',
    'readable_avg_part_size_uncompressed',
    'readable_max_part_size_compressed',
    'readable_max_part_size_uncompressed',
    'readable_total_rows',
    'parts_count',
    'latest_modification',
    'readable_primary_keys_size',
    'readable_detached_bytes_on_disk',
    'engine',
  ],
  columnFormats: {
    table: [
      'link',
      { href: '/table?host=[ctx.hostId]&database=[_database]&table=[_table]' },
    ],
    engine: 'colored-badge',
    readable_total_rows: 'background-bar',
    readable_compressed: 'background-bar',
    readable_uncompressed: 'background-bar',
    readable_avg_part_size_compressed: 'background-bar',
    readable_avg_part_size_uncompressed: 'background-bar',
    readable_primary_keys_size: 'background-bar',
    compr_rate: 'background-bar',
    parts_count: [
      'link',
      {
        href: '/part-info?host=[ctx.hostId]&database=[_database]&table=[_table]',
      },
    ],
    readable_max_part_size_compressed: 'background-bar',
    readable_max_part_size_uncompressed: 'background-bar',
  },
  clickhouseSettings: {
    allow_experimental_analyzer: 0,
  },
  columnSizing: {
    table: { size: 280, minSize: 160 },
    compressed: { size: 110, minSize: 80 },
    uncompressed: { size: 110, minSize: 80 },
    compr_rate: { size: 90, minSize: 70 },
    avg_part_size_compressed: { size: 110, minSize: 80 },
    avg_part_size_uncompressed: { size: 110, minSize: 80 },
    max_part_size_compressed: { size: 110, minSize: 80 },
    max_part_size_uncompressed: { size: 110, minSize: 80 },
    total_rows: { size: 110, minSize: 80 },
    parts_count: { size: 80, minSize: 60 },
    latest_modification: { size: 150, minSize: 120 },
    primary_keys_size: { size: 110, minSize: 80 },
    detached_bytes_on_disk: { size: 110, minSize: 80 },
    engine: { size: 130, minSize: 90 },
  },
  sortingFns: {
    compressed: 'sort_column_using_actual_value',
    uncompressed: 'sort_column_using_actual_value',
    avg_part_size_compressed: 'sort_column_using_actual_value',
    avg_part_size_uncompressed: 'sort_column_using_actual_value',
    max_part_size_compressed: 'sort_column_using_actual_value',
    max_part_size_uncompressed: 'sort_column_using_actual_value',
  },
}
