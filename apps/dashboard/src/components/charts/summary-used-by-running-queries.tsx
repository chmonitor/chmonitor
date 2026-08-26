import { ArrowRightIcon } from '@radix-ui/react-icons'

import type { ChartProps } from '@/components/charts/chart-props'

import { CardMultiMetrics } from '@/components/cards/card-multi-metrics'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { ChartError } from '@/components/charts/chart-error'
import { ChartSkeleton } from '@/components/skeletons'
import { statValueClassName } from '@/components/charts/primitives/stat-tile'
import { AppLink as Link } from '@/components/ui/app-link'
import {
  extractNestedData,
  transformRunningQueriesSummaryData,
} from '@/lib/chart-data-transforms'
import { formatReadableQuantity } from '@/lib/format-readable'
import { useChartData } from '@/lib/swr'

export const ChartSummaryUsedByRunningQueries =
  function ChartSummaryUsedByRunningQueries({
    title,
    className,
    hostId,
  }: ChartProps) {
    // Single API call that returns all data combined
    const { data, error, isLoading, sql } = useChartData<{
      main: {
        query_count: number
        memory_usage: number
        readable_memory_usage: string
      }[]
      totalMem: { metric: string; total: number; readable_total: string }[]
      todayQueryCount: { query_count: number }[]
      rowsReadWritten: {
        rows_read: number
        rows_written: number
        readable_rows_read: string
        readable_rows_written: string
      }[]
    }>({
      chartName: 'summary-used-by-running-queries',
      hostId,
    })

    const transformedData = (() => {
      if (!data || data.length === 0) return null

      const summaryData = {
        main: extractNestedData<{
          query_count: number
          memory_usage: number
          readable_memory_usage: string
        }>(data, 'main'),
        totalMem: extractNestedData<{
          metric: string
          total: number
          readable_total: string
        }>(data, 'totalMem'),
        todayQueryCount: extractNestedData<{
          query_count: number
        }>(data, 'todayQueryCount'),
        rowsReadWritten: extractNestedData<{
          rows_read: number
          rows_written: number
          readable_rows_read: string
          readable_rows_written: string
        }>(data, 'rowsReadWritten'),
      }

      const baseResult = transformRunningQueriesSummaryData(summaryData)
      if (!baseResult) return null

      // Override the today query count with formatted version
      const todayQueryCount = summaryData.todayQueryCount?.[0]?.query_count
      const queryCount = summaryData.main?.[0]?.query_count ?? 0

      return {
        ...baseResult,
        items: baseResult.items.map((item, index) => {
          // Update the second item (query count comparison) with formatted values
          if (index === 1) {
            return {
              ...item,
              targetReadable: `${formatReadableQuantity(todayQueryCount ?? queryCount)} today`,
            }
          }
          return item
        }),
      }
    })()

    if (isLoading) {
      return <ChartSkeleton title={title} className={className} />
    }

    if (error) {
      return <ChartError error={error} title={title} className={className} />
    }

    // Show empty state if no data or transformation failed
    if (!data || data.length === 0 || !transformedData) {
      return <ChartEmpty title={title} className={className} />
    }

    const queryCount = transformedData.raw.used.query_count ?? 0
    const currentMemory = transformedData.raw.used.readable_memory_usage
    const totalMemory = transformedData.raw.totalMem.readable_total

    return (
      <ChartCard title={title} sql={sql} className={className}>
        <CardMultiMetrics
          primary={
            <Link
              href={`/running-queries?host=${hostId}`}
              className="flex items-baseline gap-2 hover:opacity-70 transition-opacity"
            >
              <span className={statValueClassName}>{queryCount}</span>
              <span className="text-base text-muted-foreground">running</span>
              <span className="text-base font-medium">{currentMemory}</span>
              <span className="text-base text-muted-foreground">
                {totalMemory}
              </span>
              <ArrowRightIcon className="size-4 ml-1 text-muted-foreground" />
            </Link>
          }
          items={transformedData.items}
        />
      </ChartCard>
    )
  }

export default ChartSummaryUsedByRunningQueries
