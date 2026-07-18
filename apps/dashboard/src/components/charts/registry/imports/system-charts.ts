/**
 * System chart imports
 *
 * Lazy-loaded system metric charts.
 */

import type { ChartRegistryMap } from '../types'

import { lazy } from 'react'

export const systemChartImports: ChartRegistryMap = {
  'disk-size': lazy(() =>
    import('@/components/charts/system/disk-size').then((m) => ({
      default: m.ChartDiskSize,
    }))
  ),
  'disk-usage-trend': lazy(() =>
    import('@/components/charts/system/disk-usage-trend').then((m) => ({
      default: m.ChartDiskUsageTrend,
    }))
  ),
  'disks-usage': lazy(() =>
    import('@/components/charts/system/disks-usage').then((m) => ({
      default: m.ChartDisksUsage,
    }))
  ),
  'backup-size': lazy(() =>
    import('@/components/charts/system/backup-size').then((m) => ({
      default: m.ChartBackupSize,
    }))
  ),
  'memory-usage': lazy(() =>
    import('@/components/charts/system/memory-usage').then((m) => ({
      default: m.ChartMemoryUsage,
    }))
  ),
  'cpu-usage': lazy(() =>
    import('@/components/charts/system/cpu-usage').then((m) => ({
      default: m.ChartCPUUsage,
    }))
  ),
  'memory-breakdown': lazy(() =>
    import('@/components/charts/system/memory-breakdown').then((m) => ({
      default: m.ChartMemoryBreakdown,
    }))
  ),
  'cpu-load-average': lazy(() =>
    import('@/components/charts/system/cpu-load-average').then((m) => ({
      default: m.ChartCpuLoadAverage,
    }))
  ),
  'cpu-mode-split': lazy(() =>
    import('@/components/charts/system/cpu-mode-split').then((m) => ({
      default: m.ChartCpuModeSplit,
    }))
  ),
  'thread-pool-utilization': lazy(() =>
    import('@/components/charts/system/thread-pool-utilization').then((m) => ({
      default: m.ChartThreadPoolUtilization,
    }))
  ),
  'disk-usage-by-database': lazy(() =>
    import('@/components/charts/system/disk-usage-by-database').then((m) => ({
      default: m.ChartDiskUsageByDatabase,
    }))
  ),
  'data-freshness': lazy(() =>
    import('@/components/charts/system/data-freshness').then((m) => ({
      default: m.ChartDataFreshness,
    }))
  ),
  'compression-ratio': lazy(() =>
    import('@/components/charts/system/compression-ratio').then((m) => ({
      default: m.ChartCompressionRatio,
    }))
  ),
  'partition-part-health': lazy(() =>
    import('@/components/charts/system/partition-part-health').then((m) => ({
      default: m.ChartPartitionPartHealth,
    }))
  ),
  'oom-killed-queries': lazy(() =>
    import('@/components/charts/system/oom-killed-queries').then((m) => ({
      default: m.ChartOomKilledQueries,
    }))
  ),
  'top-memory-queries': lazy(() =>
    import('@/components/charts/system/top-memory-queries').then((m) => ({
      default: m.ChartTopMemoryQueries,
    }))
  ),
  'mutation-progress': lazy(() =>
    import('@/components/charts/system/mutation-progress').then((m) => ({
      default: m.ChartMutationProgress,
    }))
  ),
  'keeper-requests': lazy(() =>
    import('@/components/charts/system/keeper-requests').then((m) => ({
      default: m.ChartKeeperRequests,
    }))
  ),
  'keeper-wait-time': lazy(() =>
    import('@/components/charts/system/keeper-wait-time').then((m) => ({
      default: m.ChartKeeperWaitTime,
    }))
  ),
  'disk-io-throughput': lazy(() =>
    import('@/components/charts/system/disk-io-throughput').then((m) => ({
      default: m.ChartDiskIOThroughput,
    }))
  ),
  'storage-policies': lazy(() =>
    import('@/components/charts/system/storage-policies').then((m) => ({
      default: m.ChartStoragePolicies,
    }))
  ),
}
