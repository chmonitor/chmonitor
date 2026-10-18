import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { ChartError } from '@/components/charts/chart-error'
import { ChartSkeleton } from '@/components/skeletons'
import { Badge } from '@/components/ui/badge'
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
import {
  STATUS_BADGE_CLASS,
  type StatusTone,
} from '@/lib/utils/status-badge-class'

interface ReplicationLagData {
  database: string
  table: string
  replica_name: string
  absolute_delay: number
  lag_status: 'synced' | 'slight lag' | 'moderate lag' | 'severe lag'
  readable_delay: string
  inserts_in_queue: number
  merges_in_queue: number
  [key: string]: string | number // Index signature for ChartDataPoint compatibility
}

const LAG_STATUS_TONE: Record<ReplicationLagData['lag_status'], StatusTone> = {
  synced: 'ok',
  'slight lag': 'warning',
  'moderate lag': 'caution',
  'severe lag': 'error',
}

export const ChartReplicationLag = function ChartReplicationLag({
  title = 'Replication Lag',
  className,
  hostId,
}: ChartProps) {
  const { data, isLoading, error, mutate, sql } =
    useChartData<ReplicationLagData>({
      chartName: 'replication-lag',
      hostId,
      refreshInterval: REFRESH_INTERVAL.MEDIUM_30S,
    })

  const dataArray = Array.isArray(data) ? data : undefined

  if (isLoading) return <ChartSkeleton title={title} className={className} />
  if (error) return <ChartError error={error} title={title} onRetry={mutate} />

  if (!dataArray || dataArray.length === 0) {
    return (
      <ChartEmpty
        title={title}
        className={className}
        description="No replicated tables or all replicas are in sync"
      />
    )
  }

  return (
    <ChartCard
      title={title}
      className={cn('justify-between', className)}
      sql={sql}
      data={dataArray}
      data-testid="replication-lag-chart"
    >
      <div className="flex flex-col justify-between overflow-x-auto p-0">
        <Table className={className}>
          <TableHeader>
            <TableRow>
              <TableHead>Table</TableHead>
              <TableHead>Replica</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Delay</TableHead>
              <TableHead>Queue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dataArray.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell className="font-mono text-sm">
                  {row.database}.{row.table}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.replica_name}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs',
                      STATUS_BADGE_CLASS[LAG_STATUS_TONE[row.lag_status]]
                    )}
                  >
                    {row.lag_status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {row.absolute_delay > 0 ? row.readable_delay : '-'}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.inserts_in_queue > 0 || row.merges_in_queue > 0
                    ? `${row.inserts_in_queue}i / ${row.merges_in_queue}m`
                    : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ChartCard>
  )
}

export type ChartReplicationLagProps = ChartProps

export default ChartReplicationLag
