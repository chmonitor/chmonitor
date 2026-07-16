import { GitCompareArrowsIcon } from 'lucide-react'

import { memo } from 'react'
import { ChartDistributedQueriesOverTime } from '@/components/charts/traffic/distributed-queries-over-time'
import { ChartReplicaFetchTraffic } from '@/components/charts/traffic/replica-fetch-traffic'
import { useChartData } from '@/lib/query/use-chart-data'
import { REFRESH_INTERVAL, useHostId } from '@/lib/swr'

interface ClusterShapeRow {
  replicated_tables: number
  max_replicas: number
  clusters: number
  max_shards: number
  [key: string]: unknown
}

interface TrafficReplicationSectionProps {
  chartClassName?: string
  chartCardContentClassName?: string
}

/**
 * Smart-detected "Replication & Distribution" section for /traffic.
 *
 * Probes the cluster shape once (traffic-cluster-shape: cheap one-row query of
 * system.replicas / system.clusters) and renders only what is actually relevant:
 * - Replica Fetch Traffic when the cluster replicates (replicated_tables > 0)
 * - Distributed Queries when the cluster shards (max_shards > 1)
 *
 * On a plain single-node instance neither condition holds, so the section is
 * absent entirely. While loading or on error it returns null (no skeleton flash)
 * so the page never shows an empty replication header.
 */
export const TrafficReplicationSection = memo(
  function TrafficReplicationSection({
    chartClassName,
    chartCardContentClassName,
  }: TrafficReplicationSectionProps) {
    const hostId = useHostId()

    const shape = useChartData<ClusterShapeRow>({
      chartName: 'traffic-cluster-shape',
      hostId,
      refreshInterval: REFRESH_INTERVAL.SLOW_2M,
    })

    if (shape.isLoading || shape.error) return null

    const row = shape.data?.[0]
    if (!row) return null

    const hasReplication = Number(row.replicated_tables ?? 0) > 0
    const hasShards = Number(row.max_shards ?? 0) > 1

    if (!hasReplication && !hasShards) return null

    return (
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <GitCompareArrowsIcon
            className="size-4 text-muted-foreground"
            strokeWidth={1.5}
          />
          <h2 className="text-sm font-medium text-foreground">
            Replication & Distribution
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
          {hasReplication ? (
            <ChartReplicaFetchTraffic
              chartClassName={chartClassName}
              chartCardContentClassName={chartCardContentClassName}
            />
          ) : null}
          {hasShards ? (
            <ChartDistributedQueriesOverTime
              chartClassName={chartClassName}
              chartCardContentClassName={chartCardContentClassName}
            />
          ) : null}
        </div>
      </div>
    )
  }
)

export default TrafficReplicationSection
