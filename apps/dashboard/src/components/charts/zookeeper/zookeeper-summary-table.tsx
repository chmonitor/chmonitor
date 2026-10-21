import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartError, ChartSkeleton } from '@/components/charts'
import { ChartEmpty } from '@/components/charts/chart-empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { REFRESH_INTERVAL, useChartData } from '@/lib/swr'
import { cn } from '@/lib/utils'

export const ChartZookeeperSummaryTable = function ChartZookeeperSummaryTable({
  title = 'ZooKeeper Current Metrics',
  className,
  hostId,
}: ChartProps) {
  const { data, error, isLoading, mutate, sql } = useChartData<{
    metric: string
    value: string
    desc: string
  }>({
    chartName: 'zookeeper-summary-table',
    hostId,
    refreshInterval: REFRESH_INTERVAL.MEDIUM_30S,
  })

  const dataArray = Array.isArray(data) ? data : undefined

  if (isLoading) {
    return <ChartSkeleton title={title} className={className} />
  }

  if (error) {
    return (
      <ChartError
        title={title}
        error={error}
        onRetry={mutate}
        className={className}
      />
    )
  }

  if (!dataArray || dataArray.length === 0) {
    return <ChartEmpty title={title} className={className} />
  }

  const headers = Object.keys(dataArray[0])

  return (
    <ChartCard
      title={title}
      className={cn('justify-between', className)}
      sql={sql}
      data={dataArray}
    >
      <div className="flex flex-col justify-between p-0">
        <Table className={className}>
          <TableHeader>
            <TableRow>
              {headers.map((header) => (
                <TableHead key={header}>{header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {dataArray.map((row) => (
              <TableRow key={row.metric}>
                {Object.entries(row).map(([key, value]) => {
                  return <TableCell key={key}>{value ?? ''} </TableCell>
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ChartCard>
  )
}

export default ChartZookeeperSummaryTable
