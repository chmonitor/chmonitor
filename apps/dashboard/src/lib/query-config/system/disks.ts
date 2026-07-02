import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export type Row = {
  name: string
  path: string
  used_space: number
  readable_used_space: string
  unreserved_space: number
  readable_unreserved_space: string
  free_space: number
  readable_free_space: string
  total_space: number
  readable_total_space: string
  percent_free: string
  keep_free_space: number
  /** Disk engine type, only present on some ClickHouse versions */
  type?: string
}

export const diskSpaceConfig: QueryConfig = {
  name: 'disks',
  card: { primary: 'name' },
  sql: `
      SELECT name,
             path,
             (total_space - unreserved_space) AS used_space,
             formatReadableSize(used_space) AS readable_used_space,
             unreserved_space,
             formatReadableSize(unreserved_space) AS readable_unreserved_space,
             free_space,
             formatReadableSize(free_space) AS readable_free_space,
             total_space,
             formatReadableSize(total_space) AS readable_total_space,
             toString(round(100.0 * free_space / total_space, 2)) || '%' AS percent_free,
             keep_free_space
      FROM system.disks
      ORDER BY name
    `,
  columns: [
    'name',
    'path',
    'readable_used_space',
    'readable_total_space',
    'readable_unreserved_space',
    'readable_free_space',
    'percent_free',
    'keep_free_space',
  ],
  // Usually only a handful of disks, each with many size columns — cards read
  // better than a wide table.
  defaultView: 'cards',
  columnFormats: {
    name: ColumnFormat.ColoredBadge,
  },
  relatedCharts: [
    [
      'disk-size',
      {
        title: 'Disk Used',
      },
    ],
    [
      'disks-usage',
      {
        title: 'Disk Usage',
        interval: 'toStartOfDay',
        lastHours: 24 * 14,
      },
    ],
    [
      'disk-usage-trend',
      {
        title: 'Disk Usage Trend (7 Days)',
        interval: 'toStartOfHour',
        lastHours: 24 * 7,
      },
    ],
  ],
}

export type DatabaseUsedSpace = {
  database: string
  used_space: number
  readable_used_space: string
}

export const databaseDiskSpaceConfig: QueryConfig = {
  name: 'database-disk-usage',
  sql: `
      SELECT database,
             SUM(bytes_on_disk) AS used_space,
             ROUND(100.0 * used_space / nullIf(SUM(used_space) over (), 0), 2) AS pct_used_space,
             formatReadableSize(used_space) AS readable_used_space,
             SUM(data_compressed_bytes) AS data_compressed,
             ROUND(100.0 * data_compressed / nullIf(SUM(data_compressed) over (), 0), 2) AS pct_data_compressed,
             formatReadableSize(data_compressed) AS readable_data_compressed
      FROM system.parts
      WHERE active
      GROUP BY 1
      ORDER BY 2 DESC
    `,
  columns: ['database', 'readable_used_space', 'readable_data_compressed'],
  columnFormats: {
    database: [ColumnFormat.Link, { href: '/disks/database/[database]' }],
    readable_used_space: ColumnFormat.BackgroundBar,
    readable_data_compressed: ColumnFormat.BackgroundBar,
  },
}

export const databaseDiskSpaceByDatabaseConfig: QueryConfig = {
  name: 'database-disk-usage-by-database',
  sql: `
      SELECT table,
             SUM(bytes_on_disk) AS used_space,
             ROUND(100.0 * used_space / nullIf(SUM(used_space) over (), 0), 2) AS pct_used_space,
             formatReadableSize(used_space) AS readable_used_space,
             SUM(data_compressed_bytes) AS data_compressed,
             ROUND(100.0 * data_compressed / nullIf(SUM(data_compressed) over (), 0), 2) AS pct_data_compressed,
             formatReadableSize(data_compressed) AS readable_data_compressed
      FROM system.parts
      WHERE active AND database = {database:String}
      GROUP BY 1
      ORDER BY 2 DESC
    `,
  columns: ['table', 'readable_used_space', 'readable_data_compressed'],
  columnFormats: {
    database: ColumnFormat.ColoredBadge,
    readable_used_space: ColumnFormat.BackgroundBar,
    readable_data_compressed: ColumnFormat.BackgroundBar,
  },
  defaultParams: {
    database: 'default',
  },
}
