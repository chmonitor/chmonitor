import type { ChartProps } from '@/components/charts/chart-props'

import { CardMultiMetrics } from '@/components/cards/card-multi-metrics'
import { createCustomChart } from '@/components/charts/factory'
import { ReplicationNotUsed } from '@/components/replication/replication-not-used'
import { useHostId } from '@/lib/swr'
import { useReplicationUsed } from '@/lib/swr/use-replication-usage'

const ChartReplicationQueueCountInner = createCustomChart({
  chartName: 'replication-queue-count',
  dataTestId: 'replication-queue-count-chart',
  chartCardClassName: 'justify-between',
  render: (dataArray) => {
    const count = dataArray[0] as {
      count_all: number
      count_executing: number
    }

    return (
      <div className="flex flex-col justify-between p-0">
        <CardMultiMetrics
          primary={
            <span className="flex flex-row items-center gap-2">
              {count.count_executing} executing
            </span>
          }
          items={[]}
          className="p-2"
        />
        <div className="text-muted-foreground pl-2 text-sm">
          {count.count_all} in total
        </div>
      </div>
    )
  },
})

export function ChartReplicationQueueCount(props: ChartProps) {
  const hostId = useHostId()
  const used = useReplicationUsed(props.hostId ?? hostId)
  if (used === false) return <ReplicationNotUsed compact />
  return <ChartReplicationQueueCountInner {...props} />
}

export type ChartReplicationQueueCountProps = ChartProps

export default ChartReplicationQueueCount
