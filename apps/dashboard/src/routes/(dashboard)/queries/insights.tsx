import { createFileRoute } from '@tanstack/react-router'

import { ChartQueryInsightsCacheHitRatio } from '@/components/charts/query-performance/query-insights-cache-hit-ratio'
import { ChartQueryInsightsErrors } from '@/components/charts/query-performance/query-insights-errors'
import { ChartQueryInsightsLatency } from '@/components/charts/query-performance/query-insights-latency'
import { ChartQueryInsightsOperations } from '@/components/charts/query-performance/query-insights-operations'
import { ChartQueryInsightsQps } from '@/components/charts/query-performance/query-insights-qps'
import { ChartQueryInsightsRows } from '@/components/charts/query-performance/query-insights-rows'

function QueryInsightsPage() {
  return (
    <div className="flex flex-col gap-4 sm:gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Query Insights
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Query volume, latency, operations, resource usage, cache
          effectiveness, and errors from system.query_log
        </p>
      </div>

      <div className="grid auto-rows-[320px] grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <ChartQueryInsightsQps />
        <ChartQueryInsightsLatency />
        <ChartQueryInsightsOperations />
        <ChartQueryInsightsRows />
        <ChartQueryInsightsCacheHitRatio />
        <ChartQueryInsightsErrors />
      </div>
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/queries/insights')({
  component: QueryInsightsPage,
})
