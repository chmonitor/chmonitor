/**
 * DECLARATIVE_CATALOG — Plan 02L-prep.
 *
 * Central registry of all declarative query configs keyed by their .name
 * field. Used by getQueryConfigByName when CHM_CONFIG_SOURCE=declarative.
 *
 * This file is DORMANT at runtime when the default flag (ts) is in effect —
 * getQueryConfigByName falls through to the TS queries array instead.
 * Flip CHM_CONFIG_SOURCE=declarative to route lookups here.
 */

import type { DeclarativeQueryConfig } from '../schema'

import {
  anomalySummaryDeclarative,
  diskUsageChangeDeclarative,
  errorRateBaselineDeclarative,
  memoryUsageBaselineDeclarative,
  mergePerformanceBaselineDeclarative,
  queryCountBaselineDeclarative,
  replicationLagBaselineDeclarative,
} from './anomaly/anomaly-queries'
import { explorerColumnsDeclarative } from './explorer/columns'
import { explorerDatabasesDeclarative } from './explorer/databases'
import { explorerDdlDeclarative } from './explorer/ddl'
import {
  explorerAllDependenciesDeclarative,
  explorerDatabaseDependenciesDeclarative,
  explorerDependenciesDownstreamDeclarative,
  explorerDependenciesUpstreamDeclarative,
  explorerDictionarySourceDeclarative,
  explorerTableDependenciesDeclarative,
} from './explorer/dependencies'
import { explorerIndexesDeclarative } from './explorer/indexes'
import { explorerProjectionsDeclarative } from './explorer/projections'
import { explorerSkipIndexesDeclarative } from './explorer/skip-indexes'
import { explorerTablesDeclarative } from './explorer/tables'
import { keeperConnectionLogDeclarative } from './keeper/keeper-connection-log'
import { keeperInfoDeclarative } from './keeper/keeper-info'
import { keeperLogDeclarative } from './keeper/keeper-log'
import { keeperOverviewDeclarative } from './keeper/keeper-overview'
import { keeperPresenceDeclarative } from './keeper/keeper-presence'
import { keeperWatchesDeclarative } from './keeper/keeper-watches'
import { crashLogDeclarative } from './logs/crashes'
import { stackTracesDeclarative } from './logs/stack-traces'
import { textLogDeclarative } from './logs/text-log'
import { mergePerformanceDeclarative } from './merges/merge-performance'
import { mergesDeclarative } from './merges/merges'
import { mutationsDeclarative } from './merges/mutations'
import { asynchronousMetricsDeclarative } from './more/asynchronous-metrics'
import { backupsDeclarative } from './more/backups'
import { dictionariesDeclarative } from './more/dictionaries'
import { errorsDeclarative } from './more/errors'
import { hotQueryShapesDeclarative } from './more/hot-query-shapes'
import { mergeTreeSettingsDeclarative } from './more/mergetree-settings'
import { metricsDeclarative } from './more/metrics'
import { rolesDeclarative } from './more/roles'
import { settingsDeclarative } from './more/settings'
import { topUsageColumnsDeclarative } from './more/top-usage-columns'
import { topUsageTablesDeclarative } from './more/top-usage-tables'
import { unusedColumnsDeclarative } from './more/unused-columns'
import { unusedProjectionsDeclarative } from './more/unused-projections'
import { unusedTablesDeclarative } from './more/unused-tables'
import { zookeeperDeclarative } from './more/zookeeper'
import { commonErrorsDeclarative } from './queries/common-errors'
import { parallelizationDeclarative } from './queries/parallelization'
import { profilerDeclarative } from './queries/profiler'
import { queryCacheDeclarative } from './queries/query-cache'
import { queryConditionCacheDeclarative } from './queries/query-condition-cache'
import { queryDetailDeclarative } from './queries/query-detail'
import { queryViewsLogDeclarative } from './queries/query-views-log'
import { threadAnalysisDeclarative } from './queries/thread-analysis'
import { loginAttemptsDeclarative } from './security/login-attempts'
import { sessionsDeclarative } from './security/sessions'
import { asynchronousInsertLogDeclarative } from './system/asynchronous-insert-log'
import { asynchronousInsertsDeclarative } from './system/asynchronous-inserts'
import { backgroundSchedulePoolDeclarative } from './system/background-schedule-pool'
import { backgroundSchedulePoolLogDeclarative } from './system/background-schedule-pool-log'
import {
  clusterLiveMetricsAllDeclarative,
  clusterLiveMetricsDeclarative,
} from './system/cluster-live-metrics'
import { clustersDeclarative } from './system/clusters'
import { clustersTopologyDeclarative } from './system/clusters-topology'
import {
  databaseTableColumnsDeclarative,
  tablesListDeclarative,
} from './system/database-table'
import {
  databaseDiskSpaceByDatabaseDeclarative,
  databaseDiskSpaceDeclarative,
  diskSpaceDeclarative,
} from './system/disks'
import { histogramMetricsDeclarative } from './system/histogram-metrics'
import { indexAnalyticsDeclarative } from './system/index-analytics'
import { kafkaConsumersDeclarative } from './system/kafka-consumers'
import { latencyLogDeclarative } from './system/latency-log'
import { opentelemetrySpansDeclarative } from './system/opentelemetry-spans'
import { partLogDeclarative } from './system/part-log'
import { projectionAnalyticsDeclarative } from './system/projection-analytics'
import { queryMetricLogDeclarative } from './system/query-metric-log'
import { rabbitmqConsumersDeclarative } from './system/rabbitmq-consumers'
import {
  clustersReplicasStatusDeclarative,
  replicaTablesDeclarative,
} from './system/replicas-status'
import { replicatedMergeTreeSettingsDeclarative } from './system/replicated-merge-tree-settings'
import { schedulerDeclarative } from './system/scheduler'
import { workloadsDeclarative } from './system/workloads'
import { detachedPartsDeclarative } from './tables/detached-parts'
import { detachedPartsTriageDeclarative } from './tables/detached-parts-triage'
import { distributedDdlQueueDeclarative } from './tables/distributed-ddl-queue'
import { droppedTablesDeclarative } from './tables/dropped-tables'
import { movesDeclarative } from './tables/moves'
import { partInfoDeclarative } from './tables/part-info'
import { projectionsDeclarative } from './tables/projections'
import { replicasDeclarative } from './tables/replicas'
import { replicatedFetchesDeclarative } from './tables/replicated-fetches'
import { replicationQueueDeclarative } from './tables/replication-queue'
import { tablesOverviewDeclarative } from './tables/tables-overview'
import { userProcessesDeclarative } from './tables/user-processes'
import { viewRefreshesDeclarative } from './tables/view-refreshes'

const ALL_DECLARATIVE: DeclarativeQueryConfig[] = [
  queryCountBaselineDeclarative,
  memoryUsageBaselineDeclarative,
  mergePerformanceBaselineDeclarative,
  replicationLagBaselineDeclarative,
  errorRateBaselineDeclarative,
  diskUsageChangeDeclarative,
  anomalySummaryDeclarative,

  explorerColumnsDeclarative,
  explorerDatabasesDeclarative,
  explorerDdlDeclarative,
  explorerDatabaseDependenciesDeclarative,
  explorerDictionarySourceDeclarative,
  explorerDependenciesDownstreamDeclarative,
  explorerDependenciesUpstreamDeclarative,
  explorerAllDependenciesDeclarative,
  explorerTableDependenciesDeclarative,
  explorerIndexesDeclarative,
  explorerProjectionsDeclarative,
  explorerSkipIndexesDeclarative,
  explorerTablesDeclarative,

  keeperConnectionLogDeclarative,
  keeperInfoDeclarative,
  keeperLogDeclarative,
  keeperOverviewDeclarative,
  keeperPresenceDeclarative,
  keeperWatchesDeclarative,

  crashLogDeclarative,
  stackTracesDeclarative,
  textLogDeclarative,

  mergesDeclarative,
  mergePerformanceDeclarative,
  mutationsDeclarative,

  asynchronousMetricsDeclarative,
  backupsDeclarative,
  dictionariesDeclarative,
  errorsDeclarative,
  mergeTreeSettingsDeclarative,
  metricsDeclarative,
  rolesDeclarative,
  settingsDeclarative,
  topUsageColumnsDeclarative,
  topUsageTablesDeclarative,
  unusedTablesDeclarative,
  unusedColumnsDeclarative,
  hotQueryShapesDeclarative,
  unusedProjectionsDeclarative,
  zookeeperDeclarative,

  commonErrorsDeclarative,
  parallelizationDeclarative,
  profilerDeclarative,
  queryCacheDeclarative,
  queryConditionCacheDeclarative,
  queryDetailDeclarative,
  queryViewsLogDeclarative,
  threadAnalysisDeclarative,

  loginAttemptsDeclarative,
  sessionsDeclarative,

  clusterLiveMetricsDeclarative,
  clusterLiveMetricsAllDeclarative,
  clustersTopologyDeclarative,
  clustersDeclarative,
  databaseTableColumnsDeclarative,
  tablesListDeclarative,
  diskSpaceDeclarative,
  databaseDiskSpaceDeclarative,
  databaseDiskSpaceByDatabaseDeclarative,
  queryMetricLogDeclarative,
  kafkaConsumersDeclarative,
  rabbitmqConsumersDeclarative,
  asynchronousInsertsDeclarative,
  asynchronousInsertLogDeclarative,
  backgroundSchedulePoolDeclarative,
  backgroundSchedulePoolLogDeclarative,
  partLogDeclarative,
  clustersReplicasStatusDeclarative,
  replicaTablesDeclarative,
  replicatedMergeTreeSettingsDeclarative,
  histogramMetricsDeclarative,
  latencyLogDeclarative,
  workloadsDeclarative,
  schedulerDeclarative,
  opentelemetrySpansDeclarative,
  indexAnalyticsDeclarative,
  projectionAnalyticsDeclarative,

  detachedPartsDeclarative,
  detachedPartsTriageDeclarative,
  distributedDdlQueueDeclarative,
  droppedTablesDeclarative,
  movesDeclarative,
  partInfoDeclarative,
  projectionsDeclarative,
  replicasDeclarative,
  replicatedFetchesDeclarative,
  replicationQueueDeclarative,
  tablesOverviewDeclarative,
  userProcessesDeclarative,
  viewRefreshesDeclarative,
]

// Assert no duplicate names at module load time — two configs sharing a name
// would be a catalog authoring bug and should fail loudly.
const seen = new Set<string>()
for (const cfg of ALL_DECLARATIVE) {
  if (seen.has(cfg.name)) {
    throw new Error(
      `DECLARATIVE_CATALOG: duplicate name detected: '${cfg.name}'. Each catalog entry must have a unique name.`
    )
  }
  seen.add(cfg.name)
}

export const DECLARATIVE_CATALOG: Record<string, DeclarativeQueryConfig> =
  ALL_DECLARATIVE.reduce<Record<string, DeclarativeQueryConfig>>((acc, cfg) => {
    acc[cfg.name] = cfg
    return acc
  }, {})
