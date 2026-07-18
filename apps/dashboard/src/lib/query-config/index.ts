import type { QueryConfig } from '@/types/query-config'

import { DECLARATIVE_CATALOG } from './declarative/catalog'
import { getConfigSource, loadDeclarativeConfig } from './declarative/loader'
import { getLocalConfigCatalog } from './declarative/local-loader'
import { getPackCatalogSnapshot } from './declarative/pack-registry'
import { error } from '@chm/logger'

export type { QueryConfig } from './types'

export { getSqlForDisplay } from './types'

// Anomaly Detection
import { anomalyQueries } from './anomaly/anomaly-queries'
import {
  explorerAllDependenciesConfig,
  explorerColumnsConfig,
  explorerDatabaseCountsConfig,
  explorerDatabaseDependenciesConfig,
  explorerDatabasesConfig,
  explorerDdlConfig,
  explorerDependenciesDownstreamConfig,
  explorerDependenciesUpstreamConfig,
  explorerDictionarySourceConfig,
  explorerIndexesConfig,
  explorerProjectionsConfig,
  explorerSkipIndexesConfig,
  explorerTableDependenciesConfig,
  explorerTableOverviewConfig,
  explorerTablesConfig,
  explorerTableUsageConfig,
} from './explorer'
import {
  keeperConnectionLogConfig,
  keeperConnectionsConfig,
  keeperInfoConfig,
  keeperLogConfig,
  keeperOverviewConfig,
  keeperWatchesConfig,
} from './keeper'
import { crashLogConfig } from './logs/crashes'
import { stackTracesConfig } from './logs/stack-traces'
// Logs
import { textLogConfig } from './logs/text-log'
import { mergePerformanceConfig } from './merges/merge-performance'
import { mergesConfig } from './merges/merges'
import { mutationsConfig } from './merges/mutations'
import { asynchronousMetricsConfig } from './more/asynchronous-metrics'
import { backupsConfig } from './more/backups'
import { dictionariesConfig } from './more/dictionaries'
import { errorsConfig } from './more/errors'
import { mergeTreeSettingsConfig } from './more/mergetree-settings'
import { metricsConfig } from './more/metrics'
import { pageViewsConfig } from './more/page-views'
import { rolesConfig } from './more/roles'
import { settingsConfig } from './more/settings'
import { topUsageColumnsConfig } from './more/top-usage-columns'
import { topUsageTablesConfig } from './more/top-usage-tables'
import { usersConfig } from './more/users'
import { zookeeperConfig } from './more/zookeeper'
import { commonErrorsConfig } from './queries/common-errors'
import { expensiveQueriesConfig } from './queries/expensive-queries'
import { expensiveQueriesByMemoryConfig } from './queries/expensive-queries-by-memory'
import { failedQueriesConfig } from './queries/failed-queries'
import { historyQueriesConfig } from './queries/history-queries'
import { parallelizationConfig } from './queries/parallelization'
import { profilerConfig } from './queries/profiler'
import { queryCacheConfig } from './queries/query-cache'
import { queryChildrenConfig } from './queries/query-children'
import { queryConditionCacheConfig } from './queries/query-condition-cache'
import { queryDetailConfig } from './queries/query-detail'
import { queryProcessorsConfig } from './queries/query-processors'
import { queryViewsLogConfig } from './queries/query-views-log'
import { recentQueriesConfig } from './queries/recent-queries'
import { runningQueriesConfig } from './queries/running-queries'
import { slowQueriesConfig } from './queries/slow-queries'
import { slowQueryPatternsConfig } from './queries/slow-query-patterns'
// Thread Analysis
import { threadAnalysisConfig } from './queries/thread-analysis'
import { topCpuQueriesConfig } from './queries/top-cpu-queries'
import { topMemoryQueriesLiveConfig } from './queries/top-memory-queries-live'
import { loginAttemptsConfig } from './security/login-attempts'
// Security
import { sessionsConfig } from './security/sessions'
import { asynchronousInsertLogConfig } from './system/asynchronous-insert-log'
import { asynchronousInsertsConfig } from './system/asynchronous-inserts'
import { backgroundSchedulePoolConfig } from './system/background-schedule-pool'
import { backgroundSchedulePoolLogConfig } from './system/background-schedule-pool-log'
import { blobStorageLogConfig } from './system/blob-storage-log'
import { clusterLiveMetricsConfig } from './system/cluster-live-metrics'
import { clustersConfig } from './system/clusters'
import { clustersTopologyConfig } from './system/clusters-topology'
import {
  databaseTableColumnsConfig,
  tablesListConfig,
} from './system/database-table'
import {
  databaseDiskSpaceByDatabaseConfig,
  databaseDiskSpaceConfig,
  diskSpaceConfig,
} from './system/disks'
import { histogramMetricsConfig } from './system/histogram-metrics'
import { indexAnalyticsConfig } from './system/index-analytics'
import { kafkaConsumersConfig } from './system/kafka-consumers'
import { latencyLogConfig } from './system/latency-log'
import { opentelemetrySpansConfig } from './system/opentelemetry-spans'
import { partLogConfig } from './system/part-log'
import { projectionAnalyticsConfig } from './system/projection-analytics'
import { queryMetricLogConfig } from './system/query-metric-log'
import { rabbitmqConsumersConfig } from './system/rabbitmq-consumers'
import {
  clustersReplicasStatusConfig,
  replicaTablesConfig,
} from './system/replicas-status'
import { replicatedMergeTreeSettingsConfig } from './system/replicated-merge-tree-settings'
import { schedulerConfig } from './system/scheduler'
import {
  storageCompressionConfig,
  storagePoliciesConfig,
  ttlStorageMovesConfig,
} from './system/storage-economics'
import { warningsConfig } from './system/warnings'
import { workloadsConfig } from './system/workloads'
import { detachedPartsConfig } from './tables/detached-parts'
import { distributedDdlQueueConfig } from './tables/distributed-ddl-queue'
import { droppedTablesConfig } from './tables/dropped-tables'
import { movesConfig } from './tables/moves'
import { partInfoConfig } from './tables/part-info'
import { projectionsConfig } from './tables/projections'
import { readOnlyTablesConfig } from './tables/readonly-tables'
import { replicasConfig } from './tables/replicas'
import { replicatedFetchesConfig } from './tables/replicated-fetches'
import { replicationQueueConfig } from './tables/replication-queue'
import { tablesOverviewConfig } from './tables/tables-overview'
import { userProcessesConfig } from './tables/user-processes'
import { viewRefreshesConfig } from './tables/view-refreshes'
import { trafficPerTableConfig } from './traffic/per-table-ingestion'
export const queries: Array<QueryConfig> = [
  // Explorer
  explorerDatabasesConfig,
  explorerDatabaseCountsConfig,
  explorerTablesConfig,
  explorerColumnsConfig,
  explorerDdlConfig,
  explorerIndexesConfig,
  explorerSkipIndexesConfig,
  explorerProjectionsConfig,
  explorerTableOverviewConfig,
  explorerTableUsageConfig,
  explorerAllDependenciesConfig,
  explorerDatabaseDependenciesConfig,
  explorerDependenciesDownstreamConfig,
  explorerDependenciesUpstreamConfig,
  explorerDictionarySourceConfig,
  explorerTableDependenciesConfig,

  // Tables
  tablesOverviewConfig,
  distributedDdlQueueConfig,
  replicasConfig,
  replicationQueueConfig,
  movesConfig,
  replicatedFetchesConfig,
  readOnlyTablesConfig,
  droppedTablesConfig,
  detachedPartsConfig,
  partInfoConfig,
  projectionsConfig,
  viewRefreshesConfig,

  // Queries
  queryCacheConfig,
  queryConditionCacheConfig,
  queryViewsLogConfig,
  queryDetailConfig,
  queryChildrenConfig,
  queryProcessorsConfig,
  runningQueriesConfig,
  historyQueriesConfig,
  recentQueriesConfig,
  failedQueriesConfig,
  commonErrorsConfig,
  expensiveQueriesConfig,
  expensiveQueriesByMemoryConfig,
  topMemoryQueriesLiveConfig,
  topCpuQueriesConfig,
  slowQueriesConfig,
  slowQueryPatternsConfig,
  userProcessesConfig,
  queryMetricLogConfig,

  // Merges
  mergesConfig,
  mergePerformanceConfig,
  mutationsConfig,
  partLogConfig,

  // Traffic
  trafficPerTableConfig,

  // Settings
  settingsConfig,
  mergeTreeSettingsConfig,
  replicatedMergeTreeSettingsConfig,

  // Top Usage
  topUsageTablesConfig,
  topUsageColumnsConfig,

  // More
  backupsConfig,
  metricsConfig,
  asynchronousMetricsConfig,
  usersConfig,
  rolesConfig,
  zookeeperConfig,
  errorsConfig,
  pageViewsConfig,

  // Keeper / ZooKeeper
  keeperOverviewConfig,
  keeperInfoConfig,
  keeperConnectionsConfig,
  keeperConnectionLogConfig,
  keeperLogConfig,
  keeperWatchesConfig,

  // System
  clustersConfig,
  clustersTopologyConfig,
  clusterLiveMetricsConfig,
  clustersReplicasStatusConfig,
  replicaTablesConfig,
  diskSpaceConfig,
  databaseDiskSpaceConfig,
  databaseDiskSpaceByDatabaseConfig,
  databaseTableColumnsConfig,
  tablesListConfig,
  warningsConfig,
  kafkaConsumersConfig,
  rabbitmqConsumersConfig,
  asynchronousInsertsConfig,
  asynchronousInsertLogConfig,
  backgroundSchedulePoolConfig,
  backgroundSchedulePoolLogConfig,
  blobStorageLogConfig,
  storageCompressionConfig,
  storagePoliciesConfig,
  ttlStorageMovesConfig,
  histogramMetricsConfig,
  latencyLogConfig,
  workloadsConfig,
  schedulerConfig,
  opentelemetrySpansConfig,
  indexAnalyticsConfig,
  projectionAnalyticsConfig,

  // Security
  sessionsConfig,
  loginAttemptsConfig,

  // Logs
  textLogConfig,
  stackTracesConfig,
  crashLogConfig,

  // Thread Analysis
  threadAnalysisConfig,
  parallelizationConfig,
  profilerConfig,

  // Dictionaries
  dictionariesConfig,

  // Anomaly Detection
  ...anomalyQueries,
]

export const getQueryConfigByName = (
  name: string,
  runtimeEnv?: Record<string, string | undefined>
): QueryConfig | undefined => {
  if (!name) {
    return undefined
  }

  // Self-hosted local config override (queries.d, plan 55) — server-only.
  // Gated on the build-time `import.meta.env.SSR` constant (not a runtime
  // check) so Vite/Rollup dead-code-eliminates this whole branch, and the
  // local-loader import (node:fs + yaml) with it, out of the client bundle.
  // Checked FIRST — regardless of CHM_CONFIG_SOURCE — so a local file can
  // override a same-named built-in (TS or declarative) config.
  if (import.meta.env.SSR) {
    const local = getLocalConfigCatalog(runtimeEnv)[name]
    if (local) {
      try {
        return loadDeclarativeConfig(local)
      } catch (err) {
        error(
          `[query-config] Malformed local config for "${name}"; falling back to built-in config`,
          err
        )
      }
    }

    // Community query packs (plan 54) — extend the declarative catalog, so
    // only consulted alongside it. Callers `await ensurePacksLoaded` before
    // this synchronous lookup; the snapshot is `{}` (fail-closed) otherwise.
    if (getConfigSource(runtimeEnv) === 'declarative') {
      const pack = getPackCatalogSnapshot()[name]
      if (pack) {
        try {
          return loadDeclarativeConfig(pack)
        } catch (err) {
          error(
            `[query-config] Malformed pack config for "${name}"; falling back to built-in config`,
            err
          )
        }
      }
    }
  }

  if (getConfigSource(runtimeEnv) === 'declarative') {
    const decl = DECLARATIVE_CATALOG[name]
    if (decl) {
      // Fail-closed: a malformed catalog entry must never crash the
      // dashboard. Log it and fall through to the TS default below instead
      // of propagating the loader's validation error.
      try {
        return loadDeclarativeConfig(decl)
      } catch (err) {
        error(
          `[query-config] Malformed declarative config for "${name}"; falling back to TS config`,
          err
        )
      }
    }
  }

  return queries.find((q) => q.name === name)
}
