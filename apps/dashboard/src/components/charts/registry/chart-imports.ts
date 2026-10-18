import type { ChartRegistryMap } from './types'

import { logsChartImports } from './imports/logs-charts'
import { mergeChartImports } from './imports/merge-charts'
import { miscChartImports } from './imports/misc-charts'
import { queryChartImports } from './imports/query-charts'
import { queryPerfChartImports } from './imports/query-perf-charts'
import { replicationChartImports } from './imports/replication-charts'
import { securityChartImports } from './imports/security-charts'
import { systemChartImports } from './imports/system-charts'
import { threadChartImports } from './imports/thread-charts'
import { zookeeperChartImports } from './imports/zookeeper-charts'

export const chartImports: ChartRegistryMap = {
  ...queryChartImports,
  ...mergeChartImports,
  ...systemChartImports,
  ...replicationChartImports,
  ...zookeeperChartImports,
  ...logsChartImports,
  ...threadChartImports,
  ...miscChartImports,
  ...queryPerfChartImports,
  ...securityChartImports,
}
