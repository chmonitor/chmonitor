/**
 * DECLARATIVE_CHART_CATALOG — plans/58-declarative-chart-schema.md.
 *
 * Central registry of declarative chart definitions ported as templates,
 * keyed by their `.chartName`. Mirrors
 * `lib/query-config/declarative/catalog/index.ts`.
 *
 * DORMANT by design: nothing in the live app (routes, `chart-registry`)
 * consumes this catalog yet — every hand-authored TS chart keeps rendering
 * exactly as before. This is a template set + loader proof, not a cutover.
 * See docs/knowledge/chart-config-format.md for the authoring format and the
 * plan for how a future chart-picker / community catalog would consume it.
 */

import type { DeclarativeChart } from '../schema'

import { errorRateOverTimeDeclarative } from './logs/error-rate-over-time'
import { queryCountDeclarative } from './query/query-count'
import { queryDurationDeclarative } from './query/query-duration'
import { cpuUsageDeclarative } from './system/cpu-usage'
import { memoryUsageDeclarative } from './system/memory-usage'
import { zookeeperRequestsDeclarative } from './zookeeper/zookeeper-requests'

const ALL_DECLARATIVE_CHARTS: DeclarativeChart[] = [
  queryCountDeclarative,
  queryDurationDeclarative,
  memoryUsageDeclarative,
  cpuUsageDeclarative,
  zookeeperRequestsDeclarative,
  errorRateOverTimeDeclarative,
]

// Assert no duplicate chartNames at module load time — two catalog entries
// sharing a chartName would be an authoring bug and should fail loudly.
const seen = new Set<string>()
for (const chart of ALL_DECLARATIVE_CHARTS) {
  if (seen.has(chart.chartName)) {
    throw new Error(
      `DECLARATIVE_CHART_CATALOG: duplicate chartName detected: '${chart.chartName}'. Each catalog entry must have a unique chartName.`
    )
  }
  seen.add(chart.chartName)
}

export const DECLARATIVE_CHART_CATALOG: Record<string, DeclarativeChart> =
  ALL_DECLARATIVE_CHARTS.reduce<Record<string, DeclarativeChart>>(
    (acc, chart) => {
      acc[chart.chartName] = chart
      return acc
    },
    {}
  )
