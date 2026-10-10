/**
 * Overview Charts
 * Charts for the overview page displaying system status metrics
 */

import type { ChartQueryBuilder } from './types'

import { LOCAL_DATABASES_FILTER } from '@/lib/clickhouse-local-databases'

export const overviewCharts: Record<string, ChartQueryBuilder> = {
  'running-queries-count': () => ({
    query: `
      SELECT COUNT() as count FROM system.processes WHERE is_cancelled = 0
    `,
  }),

  'database-count': () => ({
    query: `
      SELECT countDistinct(database) as count FROM system.tables
      WHERE lower(database) NOT IN ('system', 'information_schema')
        AND ${LOCAL_DATABASES_FILTER}
    `,
  }),

  'table-count': () => ({
    query: `
      SELECT countDistinct(format('{}.{}', database, table)) as count FROM system.tables
      WHERE lower(database) NOT IN ('system', 'information_schema')
        AND ${LOCAL_DATABASES_FILTER}
    `,
  }),

  'merge-active-count': () => ({
    query: `SELECT COUNT() as count FROM system.merges`,
  }),

  'disk-size-single': () => ({
    query: `
      SELECT name,
             (total_space - unreserved_space) AS used_space,
             formatReadableSize(used_space) AS readable_used_space,
             total_space,
             formatReadableSize(total_space) AS readable_total_space
      FROM system.disks
      ORDER BY name
      LIMIT 1
    `,
  }),

  // Every disk (no LIMIT) for the overview Disk Usage breakdown card. Includes
  // the engine `type` (local / s3 / cache …) and free space so each disk row
  // can show its own bar + figures. Mirrors the column shape of diskSpaceConfig
  // in lib/query-config/system/disks.ts.
  'disk-size-all': () => ({
    query: `
      SELECT name,
             type,
             (total_space - unreserved_space) AS used_space,
             formatReadableSize(used_space) AS readable_used_space,
             total_space,
             formatReadableSize(total_space) AS readable_total_space,
             free_space,
             formatReadableSize(free_space) AS readable_free_space
      FROM system.disks
      ORDER BY name
    `,
  }),
}
