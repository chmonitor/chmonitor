import { ArrowRightIcon } from '@radix-ui/react-icons'

import type { ChartProps } from '@/components/charts/chart-props'

import { CardMultiMetrics } from '@/components/cards/card-multi-metrics'
import { ChartCard } from '@/components/cards/chart-card'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { ChartError } from '@/components/charts/chart-error'
import { ChartSkeleton } from '@/components/skeletons'
import { AppLink as Link } from '@/components/ui/app-link'
import {
  extractNestedData,
  transformMergeSummaryData,
} from '@/lib/chart-data-transforms'
import { useChartData } from '@/lib/swr'

export const ChartSummaryUsedByMerges = function ChartSummaryUsedByMerges({
  title,
  className,
  hostId,
}: ChartProps) {
  const { data, error, isLoading, sql } = useChartData<{
    used: { memory_usage: number; readable_memory_usage: string }[]
    totalMem: { metric: string; total: number; readable_total: string }[]
    rowsReadWritten: {
      rows_read: number
      rows_written: number
      readable_rows_read: string
      readable_rows_written: string
    }[]
    bytesReadWritten: {
      bytes_read: number
      bytes_written: number
      readable_bytes_read: string
      readable_bytes_written: string
    }[]
  }>({
    chartName: 'summary-used-by-merges',
    hostId,
  })

  const transformedData = (() => {
    if (!data || data.length === 0) return null

    const summaryData = {
      used: extractNestedData<{
        memory_usage: number
        readable_memory_usage: string
      }>(data, 'used'),
      totalMem: extractNestedData<{
        metric: string
        total: number
        readable_total: string
      }>(data, 'totalMem'),
      rowsReadWritten: extractNestedData<{
        rows_read: number
        rows_written: number
        readable_rows_read: string
        readable_rows_written: string
      }>(data, 'rowsReadWritten'),
      bytesReadWritten: extractNestedData<{
        bytes_read: number
        bytes_written: number
        readable_bytes_read: string
        readable_bytes_written: string
      }>(data, 'bytesReadWritten'),
    }

    return transformMergeSummaryData(summaryData)
  })()

  if (isLoading) {
    return <ChartSkeleton title={title} className={className} />
  }

  if (error) {
    return <ChartError error={error} title={title} />
  }

  // Show empty state if no data or transformation failed
  if (!data || data.length === 0 || !transformedData) {
    return <ChartEmpty title={title} className={className} />
  }

  return (
    <ChartCard title={title} sql={sql} className={className}>
      <CardMultiMetrics
        primary={
          <Link
            href={`/merges?host=${hostId}`}
            className="flex items-baseline gap-2 hover:opacity-70 transition-opacity"
          >
            <span className="text-3xl font-bold tabular-nums">
              {transformedData.raw.rowsReadWritten.readable_rows_read}
            </span>
            <span className="text-base text-muted-foreground">rows</span>
            <span className="text-base font-medium">
              {transformedData.primary.memoryUsage}
            </span>
            <ArrowRightIcon className="size-4 ml-1 text-muted-foreground" />
          </Link>
        }
        items={transformedData.items}
      />
    </ChartCard>
  )
}

export default ChartSummaryUsedByMerges
