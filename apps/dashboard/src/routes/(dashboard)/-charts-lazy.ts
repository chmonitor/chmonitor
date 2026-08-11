/**
 * Lazy chart component imports for the Overview page.
 *
 * Split out of -charts-config.ts (#2896) so the chart-section configuration
 * in that file isn't buried under ~60 boilerplate lazy-import declarations.
 * Grouped by domain in the same order they appeared in -charts-config.ts.
 */

import { lazy } from 'react'

// Connection charts
export const ChartConnectionsPool = lazy(() =>
  import('@/components/charts/connections-pool').then((mod) => ({
    default: mod.ChartConnectionsPool,
  }))
)
// Logs charts
export const ChartCrashFrequency = lazy(() =>
  import('@/components/charts/logs/crash-frequency').then((mod) => ({
    default: mod.ChartCrashFrequency,
  }))
)
export const ChartErrorRateOverTime = lazy(() =>
  import('@/components/charts/logs/error-rate-over-time').then((mod) => ({
    default: mod.ChartErrorRateOverTime,
  }))
)
export const ChartLogLevelDistribution = lazy(() =>
  import('@/components/charts/logs/log-level-distribution').then((mod) => ({
    default: mod.ChartLogLevelDistribution,
  }))
)
// Merge charts
export const ChartMergeAvgDuration = lazy(() =>
  import('@/components/charts/merge/merge-avg-duration').then((mod) => ({
    default: mod.ChartMergeAvgDuration,
  }))
)
export const ChartMergeCount = lazy(() =>
  import('@/components/charts/merge/merge-count').then((mod) => ({
    default: mod.ChartMergeCount,
  }))
)
export const ChartMergeSumReadRows = lazy(() =>
  import('@/components/charts/merge/merge-sum-read-rows').then((mod) => ({
    default: mod.ChartMergeSumReadRows,
  }))
)
export const ChartNewPartsCreated = lazy(() =>
  import('@/components/charts/merge/new-parts-created').then((mod) => ({
    default: mod.ChartNewPartsCreated,
  }))
)
export const ChartSummaryUsedByMerges = lazy(() =>
  import('@/components/charts/merge/summary-used-by-merges').then((mod) => ({
    default: mod.ChartSummaryUsedByMerges,
  }))
)
export const ChartPartsPerTable = lazy(() =>
  import('@/components/charts/parts-per-table').then((mod) => ({
    default: mod.ChartPartsPerTable,
  }))
)
// Query additional charts
export const ChartCancelledQueries = lazy(() =>
  import('@/components/charts/query/cancelled-queries').then((mod) => ({
    default: mod.ChartCancelledQueries,
  }))
)
// Query charts
export const ChartFailedQueryCount = lazy(() =>
  import('@/components/charts/query/failed-query-count').then((mod) => ({
    default: mod.ChartFailedQueryCount,
  }))
)
export const ChartFailedQueryCountByUser = lazy(() =>
  import('@/components/charts/query/failed-query-count-by-user').then(
    (mod) => ({ default: mod.ChartFailedQueryCountByUser })
  )
)
export const ChartQueryCache = lazy(() =>
  import('@/components/charts/query/query-cache').then((mod) => ({
    default: mod.ChartQueryCache,
  }))
)
export const ChartQueryCacheUsage = lazy(() =>
  import('@/components/charts/query/query-cache-usage').then((mod) => ({
    default: mod.ChartQueryCacheUsage,
  }))
)
export const ChartQueryCount = lazy(() =>
  import('@/components/charts/query/query-count').then((mod) => ({
    default: mod.ChartQueryCount,
  }))
)
export const ChartQueryCountByUser = lazy(() =>
  import('@/components/charts/query/query-count-by-user').then((mod) => ({
    default: mod.ChartQueryCountByUser,
  }))
)
export const ChartQueryCountHeatmap = lazy(() =>
  import('@/components/charts/query/query-count-heatmap').then((mod) => ({
    default: mod.ChartQueryCountHeatmap,
  }))
)
export const ChartQueryDuration = lazy(() =>
  import('@/components/charts/query/query-duration').then((mod) => ({
    default: mod.ChartQueryDuration,
  }))
)
export const ChartQueryDurationPercentiles = lazy(() =>
  import('@/components/charts/query/query-duration-percentiles').then(
    (mod) => ({ default: mod.ChartQueryDurationPercentiles })
  )
)
export const ChartQueryMemory = lazy(() =>
  import('@/components/charts/query/query-memory').then((mod) => ({
    default: mod.ChartQueryMemory,
  }))
)
export const ChartQueryType = lazy(() =>
  import('@/components/charts/query/query-type').then((mod) => ({
    default: mod.ChartQueryType,
  }))
)
export const ChartSlowQueryOccurrences = lazy(() =>
  import('@/components/charts/query/slow-query-occurrences').then((mod) => ({
    default: mod.ChartSlowQueryOccurrences,
  }))
)
// Query performance charts
export const ChartInsertPerformance = lazy(() =>
  import('@/components/charts/query-performance/insert-performance').then(
    (mod) => ({ default: mod.ChartInsertPerformance })
  )
)
export const ChartQueryDurationTrend = lazy(() =>
  import('@/components/charts/query-performance/query-duration-trend').then(
    (mod) => ({ default: mod.ChartQueryDurationTrend })
  )
)
export const ChartTopInserters = lazy(() =>
  import('@/components/charts/query-performance/top-inserters').then((mod) => ({
    default: mod.ChartTopInserters,
  }))
)
export const ChartTopQueryFingerprintsPerf = lazy(() =>
  import('@/components/charts/query-performance/top-query-fingerprints').then(
    (mod) => ({ default: mod.ChartTopQueryFingerprints })
  )
)
// Replication charts
export const ChartReadonlyReplica = lazy(() =>
  import('@/components/charts/replication/readonly-replica').then((mod) => ({
    default: mod.ChartReadonlyReplica,
  }))
)
export const ChartReplicationLag = lazy(() =>
  import('@/components/charts/replication/replication-lag').then((mod) => ({
    default: mod.ChartReplicationLag,
  }))
)
export const ChartReplicationQueueCount = lazy(() =>
  import('@/components/charts/replication/replication-queue-count').then(
    (mod) => ({ default: mod.ChartReplicationQueueCount })
  )
)
export const ChartReplicationSummaryTable = lazy(() =>
  import('@/components/charts/replication/replication-summary-table').then(
    (mod) => ({ default: mod.ChartReplicationSummaryTable })
  )
)
export const ChartSummaryStuckMutations = lazy(() =>
  import('@/components/charts/summary-stuck-mutations').then((mod) => ({
    default: mod.ChartSummaryStuckMutations,
  }))
)
// System charts
export const ChartBackupSize = lazy(() =>
  import('@/components/charts/system/backup-size').then((mod) => ({
    default: mod.ChartBackupSize,
  }))
)
export const ChartCompressionRatio = lazy(() =>
  import('@/components/charts/system/compression-ratio').then((mod) => ({
    default: mod.ChartCompressionRatio,
  }))
)
export const ChartCPUUsage = lazy(() =>
  import('@/components/charts/system/cpu-usage').then((mod) => ({
    default: mod.ChartCPUUsage,
  }))
)
export const ChartDataFreshness = lazy(() =>
  import('@/components/charts/system/data-freshness').then((mod) => ({
    default: mod.ChartDataFreshness,
  }))
)
export const ChartDiskIOThroughput = lazy(() =>
  import('@/components/charts/system/disk-io-throughput').then((mod) => ({
    default: mod.ChartDiskIOThroughput,
  }))
)
export const ChartDiskSize = lazy(() =>
  import('@/components/charts/system/disk-size').then((mod) => ({
    default: mod.ChartDiskSize,
  }))
)
export const ChartDiskUsage = lazy(() =>
  import('@/components/charts/system/disk-usage').then((mod) => ({
    default: mod.ChartDiskUsage,
  }))
)
export const ChartDiskUsageByDatabase = lazy(() =>
  import('@/components/charts/system/disk-usage-by-database').then((mod) => ({
    default: mod.ChartDiskUsageByDatabase,
  }))
)
export const ChartDiskUsageTrend = lazy(() =>
  import('@/components/charts/system/disk-usage-trend').then((mod) => ({
    default: mod.ChartDiskUsageTrend,
  }))
)
export const ChartDisksUsage = lazy(() =>
  import('@/components/charts/system/disks-usage').then((mod) => ({
    default: mod.ChartDisksUsage,
  }))
)
export const ChartMemoryUsage = lazy(() =>
  import('@/components/charts/system/memory-usage').then((mod) => ({
    default: mod.ChartMemoryUsage,
  }))
)
export const ChartMemoryBreakdown = lazy(() =>
  import('@/components/charts/system/memory-breakdown').then((mod) => ({
    default: mod.ChartMemoryBreakdown,
  }))
)
export const ChartCpuLoadAverage = lazy(() =>
  import('@/components/charts/system/cpu-load-average').then((mod) => ({
    default: mod.ChartCpuLoadAverage,
  }))
)
export const ChartCpuModeSplit = lazy(() =>
  import('@/components/charts/system/cpu-mode-split').then((mod) => ({
    default: mod.ChartCpuModeSplit,
  }))
)
export const ChartThreadPoolUtilization = lazy(() =>
  import('@/components/charts/system/thread-pool-utilization').then((mod) => ({
    default: mod.ChartThreadPoolUtilization,
  }))
)
export const ChartMutationProgress = lazy(() =>
  import('@/components/charts/system/mutation-progress').then((mod) => ({
    default: mod.ChartMutationProgress,
  }))
)
export const ChartOomKilledQueries = lazy(() =>
  import('@/components/charts/system/oom-killed-queries').then((mod) => ({
    default: mod.ChartOomKilledQueries,
  }))
)
export const ChartPartitionPartHealth = lazy(() =>
  import('@/components/charts/system/partition-part-health').then((mod) => ({
    default: mod.ChartPartitionPartHealth,
  }))
)
export const ChartStoragePolicies = lazy(() =>
  import('@/components/charts/system/storage-policies').then((mod) => ({
    default: mod.ChartStoragePolicies,
  }))
)
export const ChartTopMemoryQueries = lazy(() =>
  import('@/components/charts/system/top-memory-queries').then((mod) => ({
    default: mod.ChartTopMemoryQueries,
  }))
)
// Thread charts
export const ChartThreadUtilization = lazy(() =>
  import('@/components/charts/threads/thread-utilization').then((mod) => ({
    default: mod.ChartThreadUtilization,
  }))
)
export const ChartTopTableSize = lazy(() =>
  import('@/components/charts/top-table-size').then((mod) => ({
    default: mod.ChartTopTableSize,
  }))
)
// ZooKeeper charts
export const ChartKeeperException = lazy(() =>
  import('@/components/charts/zookeeper/zookeeper-exception').then((mod) => ({
    default: mod.ChartKeeperException,
  }))
)
export const ChartZookeeperRequests = lazy(() =>
  import('@/components/charts/zookeeper/zookeeper-requests').then((mod) => ({
    default: mod.ChartZookeeperRequests,
  }))
)
export const ChartZookeeperWait = lazy(() =>
  import('@/components/charts/zookeeper/zookeeper-wait').then((mod) => ({
    default: mod.ChartZookeeperWait,
  }))
)
