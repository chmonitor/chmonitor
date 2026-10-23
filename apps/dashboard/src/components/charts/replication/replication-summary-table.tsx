import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { ChartError } from '@/components/charts/chart-error'
import { ReplicationNotUsed } from '@/components/replication/replication-not-used'
import { ChartSkeleton } from '@/components/skeletons'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { REFRESH_INTERVAL, useChartData, useHostId } from '@/lib/swr'
import { useReplicationUsed } from '@/lib/swr/use-replication-usage'
import { cn } from '@/lib/utils'

export const ChartReplicationSummaryTable =
  function ChartReplicationSummaryTable({
    title,
    className,
    hostId,
  }: ChartProps) {
    const { data, isLoading, error, mutate, sql } = useChartData<{
      table: string
      type: string
      current_executing: number
      total: number
    }>({
      chartName: 'replication-summary-table',
      hostId,
      refreshInterval: REFRESH_INTERVAL.MEDIUM_30S,
    })

    const routeHostId = useHostId()
    const used = useReplicationUsed(hostId ?? routeHostId)
    const dataArray = Array.isArray(data) ? data : undefined

    if (used === false) return <ReplicationNotUsed compact />
    if (isLoading) return <ChartSkeleton title={title} className={className} />
    if (error)
      return <ChartError error={error} title={title} onRetry={mutate} />

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
              {dataArray.map((row, idx) => (
                <TableRow key={idx}>
                  {Object.values(row).map((value, i) => {
                    return <TableCell key={i}>{value || ''} </TableCell>
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ChartCard>
    )
  }

export default ChartReplicationSummaryTable
