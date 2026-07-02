import type { DeclarativeQueryConfig } from '../../schema'

export const clustersReplicasStatusDeclarative: DeclarativeQueryConfig = {
  name: 'replicas-status',
  defaultView: 'auto',
  card: { primary: 'host' },
  description: 'Replica status for all tables in the cluster',
  sql: `
      SELECT
          hostName() AS host,

          sum(rows) AS total_rows,
          formatReadableQuantity(total_rows) AS readable_total_rows,
          (100 * total_rows / nullIf(max(total_rows) OVER (), 0)) AS pct_total_rows,

          sum(bytes) AS total_bytes,
          formatReadableSize(sum(bytes)) AS readable_total_bytes,
          (100 * total_bytes / nullIf(max(total_bytes) OVER (), 0)) AS pct_total_bytes,

          countDistinct(database) AS database_count,
          countDistinct(database || table) AS table_count,

          countIf(active) as active_part_count,
          (100 * active_part_count / nullIf(max(active_part_count) OVER (), 0)) AS pct_active_part_count,

          count() as all_part_count,
          (100 * all_part_count / nullIf(max(all_part_count) OVER (), 0)) AS pct_all_part_count,

          sum(primary_key_size) AS primary_key_size,
          formatReadableSize(primary_key_size) AS readable_primary_key_size,
          (100 * primary_key_size / nullIf(max(primary_key_size) OVER (), 0)) AS pct_primary_key_size,

          sum(marks_bytes) AS marks_bytes,
          formatReadableSize(marks_bytes) AS readable_marks_bytes,
          (100 * marks_bytes / nullIf(max(marks_bytes) OVER (), 0)) AS pct_marks_bytes,

          max(modification_time) AS last_modification_time

      FROM clusterAllReplicas({cluster: String}, system.parts)
      WHERE active
      GROUP BY host
      ORDER BY
          1 ASC,
          2 DESC
  `,
  columns: [
    'host',
    'readable_total_rows',
    'readable_total_bytes',
    'readable_primary_key_size',
    'readable_marks_bytes',
    'active_part_count',
    'all_part_count',
    'last_modification_time',
    'database_count',
    'table_count',
  ],
  columnFormats: {
    readable_total_rows: 'background-bar',
    readable_total_bytes: 'background-bar',
    readable_primary_key_size: 'background-bar',
    readable_marks_bytes: 'background-bar',
    active_part_count: 'background-bar',
    all_part_count: 'background-bar',
    database_count: 'background-bar',
    table_count: 'background-bar',
  },
  optional: false,
}

export const replicaTablesDeclarative: DeclarativeQueryConfig = {
  name: 'count-in-replicas',
  description: 'Count across replicas for all tables in the cluster',
  sql: `
      SELECT
          hostName() AS host,

          sum(rows) AS total_rows,
          formatReadableQuantity(total_rows) AS readable_total_rows,
          (100 * total_rows / nullIf(max(total_rows) OVER (), 0)) AS pct_total_rows,

          sum(bytes) AS total_bytes,
          formatReadableSize(sum(bytes)) AS readable_total_bytes,
          (100 * total_bytes / nullIf(max(total_bytes) OVER (), 0)) AS pct_total_bytes,

          countDistinct(database) AS database_count,
          countDistinct(database || table) AS table_count,

          countIf(active) as active_part_count,
          (100 * active_part_count / nullIf(max(active_part_count) OVER (), 0)) AS pct_active_part_count,

          count() as all_part_count,
          (100 * all_part_count / nullIf(max(all_part_count) OVER (), 0)) AS pct_all_part_count,

          sum(primary_key_size) AS primary_key_size,
          formatReadableSize(primary_key_size) AS readable_primary_key_size,
          (100 * primary_key_size / nullIf(max(primary_key_size) OVER (), 0)) AS pct_primary_key_size,

          sum(marks_bytes) AS marks_bytes,
          formatReadableSize(marks_bytes) AS readable_marks_bytes,
          (100 * marks_bytes / nullIf(max(marks_bytes) OVER (), 0)) AS pct_marks_bytes,

          max(modification_time) AS last_modification_time

      FROM clusterAllReplicas({cluster: String}, system.parts)
      WHERE active
      GROUP BY 1
      ORDER BY
          1 ASC,
          2 DESC
  `,
  columns: [
    'host',
    'readable_total_rows',
    'readable_total_bytes',
    'readable_primary_key_size',
    'readable_marks_bytes',
    'active_part_count',
    'all_part_count',
    'last_modification_time',
    'database_count',
    'table_count',
  ],
  columnFormats: {
    readable_total_rows: 'background-bar',
    readable_total_bytes: 'background-bar',
    readable_primary_key_size: 'background-bar',
    readable_marks_bytes: 'background-bar',
    active_part_count: 'background-bar',
    all_part_count: 'background-bar',
    database_count: 'background-bar',
    table_count: 'background-bar',
  },
  optional: false,
}
