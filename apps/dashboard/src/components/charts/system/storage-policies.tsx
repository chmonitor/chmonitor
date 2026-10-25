import type { ChartProps } from '@/components/charts/chart-props'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartContainer } from '@/components/charts/chart-container'
import { REFRESH_INTERVAL, useChartData, useHostId } from '@/lib/swr'

type DataRow = {
  policy_name: string
  volume_name: string
  disks: string[]
  volume_priority: number
  prefer_not_to_merge: number
}

type PolicyRow = {
  policy_name: string
  volumes: string
  disks: string
  priority: number
  hasNoMerge: boolean
}

const CHART_NAME = 'storage-policies'
const DEFAULT_TITLE = 'Storage Policies'

/** Group per-volume rows into one row per policy. */
function groupByPolicy(rows: DataRow[]): PolicyRow[] {
  const map = new Map<string, PolicyRow>()

  for (const row of rows) {
    const existing = map.get(row.policy_name)
    const diskList = Array.isArray(row.disks) ? row.disks : [String(row.disks)]

    if (existing) {
      existing.volumes = existing.volumes
        ? `${existing.volumes} · ${row.volume_name}`
        : row.volume_name
      const allDisks = new Set([...existing.disks.split(', '), ...diskList])
      existing.disks = [...allDisks].filter(Boolean).join(', ')
      if (row.volume_priority < existing.priority) {
        existing.priority = row.volume_priority
      }
      if (row.prefer_not_to_merge) existing.hasNoMerge = true
    } else {
      map.set(row.policy_name, {
        policy_name: row.policy_name,
        volumes: row.volume_name,
        disks: diskList.filter(Boolean).join(', '),
        priority: row.volume_priority,
        hasNoMerge: Boolean(row.prefer_not_to_merge),
      })
    }
  }

  return [...map.values()]
}

export const ChartStoragePolicies = function ChartStoragePolicies({
  title = DEFAULT_TITLE,
  className,
  chartClassName,
}: ChartProps) {
  const hostId = useHostId()
  const swr = useChartData<DataRow>({
    chartName: CHART_NAME,
    hostId,
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })

  return (
    <ChartContainer
      swr={swr}
      title={title}
      className={className}
      chartClassName={chartClassName}
    >
      {(dataArray, sql, metadata, staleError, mutate) => {
        const rows = dataArray as DataRow[]
        const policies = groupByPolicy(rows)

        return (
          <ChartCard
            title={title}
            sql={sql}
            data={rows}
            metadata={metadata}
            data-testid="storage-policies-chart"
            staleError={staleError}
            onRetry={mutate}
          >
            <div className="w-full overflow-auto">
              <div className="min-w-[400px]">
                <div className="grid grid-cols-[1.1fr_1fr_1.2fr_auto] gap-x-3 border-b pb-2">
                  <span className="text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    Policy
                  </span>
                  <span className="text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    Volume
                  </span>
                  <span className="text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    Disks
                  </span>
                  <span className="text-right text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    Prio
                  </span>
                </div>

                {policies.map((policy) => (
                  <div
                    key={policy.policy_name}
                    className="grid grid-cols-[1.1fr_1fr_1.2fr_auto] gap-x-3 border-t py-[10px] text-[12.5px]"
                  >
                    <span className="flex items-center gap-1.5 font-mono font-semibold">
                      {policy.policy_name}
                      {policy.hasNoMerge && (
                        <span
                          className="rounded px-1 py-px text-[10px] max-sm:text-xs font-medium leading-none text-muted-foreground ring-1 ring-inset ring-border"
                          title="prefer_not_to_merge is enabled for one or more volumes"
                        >
                          no-merge
                        </span>
                      )}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {policy.volumes}
                    </span>
                    <span className="truncate font-mono text-muted-foreground">
                      {policy.disks}
                    </span>
                    <span className="text-right font-mono tabular-nums text-muted-foreground">
                      {policy.priority}
                    </span>
                  </div>
                ))}

                {policies.length === 0 && (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    No storage policies configured
                  </div>
                )}
              </div>
            </div>
          </ChartCard>
        )
      }}
    </ChartContainer>
  )
}

export type ChartStoragePoliciesProps = ChartProps

export default ChartStoragePolicies
