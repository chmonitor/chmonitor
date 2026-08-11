/**
 * Backup size chart.
 *
 * Split out of system-charts.ts (#2898). Behaviour-preserving move — no SQL,
 * key names, or gating changed.
 */

import type { ChartQueryBuilder } from '../types'

export const backupCharts: Record<string, ChartQueryBuilder> = {
  'backup-size': ({ lastHours }) => {
    const safeLastHours =
      typeof lastHours === 'number' &&
      Number.isFinite(lastHours) &&
      lastHours > 0
        ? Math.floor(lastHours)
        : undefined
    const startTimeCondition = safeLastHours
      ? `AND start_time > (now() - INTERVAL ${safeLastHours} HOUR)`
      : ''

    return {
      query: `
    SELECT
      SUM(total_size) as total_size,
      SUM(uncompressed_size) as uncompressed_size,
      SUM(compressed_size) as compressed_size,
      formatReadableSize(total_size) as readable_total_size,
      formatReadableSize(uncompressed_size) as readable_uncompressed_size,
      formatReadableSize(compressed_size) as readable_compressed_size
    FROM system.backup_log
    WHERE status = 'BACKUP_CREATED'
          ${startTimeCondition}
  `,
      optional: true,
      tableCheck: 'system.backup_log',
    }
  },

}
