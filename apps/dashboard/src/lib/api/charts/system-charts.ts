/**
 * System Metrics Charts
 * Charts for CPU, memory, disk, and other system-level metrics
 *
 * The actual chart builders live under `lib/api/charts/system/`, split by
 * subject area (#2898): cpu, memory, disk, backup, merges (merge/mutation
 * progress), data-quality (freshness/compression/top-memory-queries),
 * health + health-detail-a/b (health checks, split in two because the
 * combined slice exceeded ~250 lines), and keeper. This module re-exports
 * `systemCharts` as a single map, referencing each entry from its owning
 * slice so the original key insertion order is preserved exactly (see
 * system-charts.test.ts).
 */

import type { ChartQueryBuilder } from './types'

import { backupCharts } from './system/backup'
import { cpuCharts } from './system/cpu'
import { dataQualityCharts } from './system/data-quality'
import { diskCharts } from './system/disk'
import { healthCharts } from './system/health'
import { healthDetailACharts } from './system/health-detail-a'
import { healthDetailBCharts } from './system/health-detail-b'
import { keeperCharts } from './system/keeper'
import { memoryCharts } from './system/memory'
import { mergesCharts } from './system/merges'

export { METRICS_PERMISSION } from './system/permissions'

export const systemCharts: Record<string, ChartQueryBuilder> = {
  'memory-usage': memoryCharts['memory-usage'],
  'cpu-usage': cpuCharts['cpu-usage'],
  'memory-breakdown': memoryCharts['memory-breakdown'],
  'cpu-load-average': cpuCharts['cpu-load-average'],
  'cpu-mode-split': cpuCharts['cpu-mode-split'],
  'thread-pool-utilization': cpuCharts['thread-pool-utilization'],
  'disk-size': diskCharts['disk-size'],
  'disks-usage': diskCharts['disks-usage'],
  'backup-size': backupCharts['backup-size'],
  'new-parts-created': mergesCharts['new-parts-created'],
  'summary-used-by-running-queries':
    mergesCharts['summary-used-by-running-queries'],
  'summary-used-by-mutations': mergesCharts['summary-used-by-mutations'],
  'summary-stuck-mutations': mergesCharts['summary-stuck-mutations'],
  'disk-usage-trend': diskCharts['disk-usage-trend'],
  'disk-usage-by-database': diskCharts['disk-usage-by-database'],
  'parts-per-table': diskCharts['parts-per-table'],
  'top-table-size': diskCharts['top-table-size'],
  'mutation-progress': mergesCharts['mutation-progress'],
  'data-freshness': dataQualityCharts['data-freshness'],
  'compression-ratio': dataQualityCharts['compression-ratio'],
  'partition-part-health': diskCharts['partition-part-health'],
  'partition-part-health-summary': diskCharts['partition-part-health-summary'],
  'oom-killed-queries': mergesCharts['oom-killed-queries'],
  'top-memory-queries': dataQualityCharts['top-memory-queries'],
  'health-readonly-replicas': healthCharts['health-readonly-replicas'],
  'health-delayed-inserts': healthCharts['health-delayed-inserts'],
  'health-max-part-count': healthCharts['health-max-part-count'],
  'health-parts-pressure': healthCharts['health-parts-pressure'],
  'health-long-running-queries': healthCharts['health-long-running-queries'],
  'health-oom-killed-recent': healthCharts['health-oom-killed-recent'],
  'health-failed-queries-recent': healthCharts['health-failed-queries-recent'],
  'health-replication-lag': healthCharts['health-replication-lag'],
  'health-keeper-exceptions-recent':
    healthCharts['health-keeper-exceptions-recent'],
  'health-memory-percent': healthCharts['health-memory-percent'],
  'health-disk-percent': healthCharts['health-disk-percent'],
  'health-failed-mutations': healthCharts['health-failed-mutations'],
  'health-stuck-merges': healthCharts['health-stuck-merges'],
  'health-query-timeouts': healthCharts['health-query-timeouts'],
  'health-failed-backups': healthCharts['health-failed-backups'],
  'health-mv-refresh-failures': healthCharts['health-mv-refresh-failures'],
  'health-readonly-replicas-detail':
    healthDetailACharts['health-readonly-replicas-detail'],
  'health-max-part-count-detail':
    healthDetailACharts['health-max-part-count-detail'],
  'health-parts-pressure-detail':
    healthDetailACharts['health-parts-pressure-detail'],
  'health-long-running-queries-detail':
    healthDetailACharts['health-long-running-queries-detail'],
  'health-oom-killed-recent-detail':
    healthDetailACharts['health-oom-killed-recent-detail'],
  'health-failed-queries-recent-detail':
    healthDetailACharts['health-failed-queries-recent-detail'],
  'health-replication-lag-detail':
    healthDetailACharts['health-replication-lag-detail'],
  'health-keeper-exceptions-detail':
    healthDetailACharts['health-keeper-exceptions-detail'],
  'health-memory-percent-detail':
    healthDetailACharts['health-memory-percent-detail'],
  'health-disk-percent-detail':
    healthDetailBCharts['health-disk-percent-detail'],
  'health-failed-mutations-detail':
    healthDetailBCharts['health-failed-mutations-detail'],
  'health-stuck-merges-detail':
    healthDetailBCharts['health-stuck-merges-detail'],
  'health-query-timeouts-detail':
    healthDetailBCharts['health-query-timeouts-detail'],
  'health-failed-backups-detail':
    healthDetailBCharts['health-failed-backups-detail'],
  'health-mv-refresh-failures-detail':
    healthDetailBCharts['health-mv-refresh-failures-detail'],
  'health-stuck-mutations-detail':
    healthDetailBCharts['health-stuck-mutations-detail'],
  'health-running-mutations-detail':
    healthDetailBCharts['health-running-mutations-detail'],
  'keeper-requests': keeperCharts['keeper-requests'],
  'keeper-wait-time': keeperCharts['keeper-wait-time'],
  'disk-io-throughput': diskCharts['disk-io-throughput'],
  'storage-policies': diskCharts['storage-policies'],
}
