import { Database } from 'lucide-react'

import { KpiCard } from './kpi-card'
import { useChartData } from '@/lib/query/use-chart-data'
import { REFRESH_INTERVAL, useHostId } from '@/lib/swr'
import { buildUrl } from '@/lib/url/url-builder'

/**
 * DatabaseTableCountCard - "Schema" overview KPI.
 * Headline is the database count; the table count sits in the sub line.
 */

export const DatabaseTableCountCard = function DatabaseTableCountCard() {
  const hostId = useHostId()
  const databaseSwr = useChartData<{ count: number }>({
    chartName: 'database-count',
    hostId,
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })
  const tablesSwr = useChartData<{ count: number }>({
    chartName: 'table-count',
    hostId,
    refreshInterval: REFRESH_INTERVAL.VERY_SLOW_5M,
  })

  const isLoading = databaseSwr.isLoading || tablesSwr.isLoading
  const dbCount = databaseSwr.data?.[0]?.count ?? 0
  const tableCount = tablesSwr.data?.[0]?.count ?? 0

  return (
    <KpiCard
      icon={Database}
      tone="violet"
      label="Schema"
      value={dbCount}
      unit={dbCount === 1 ? 'database' : 'databases'}
      sub={
        <>
          <span className="font-medium tabular-nums text-foreground/80">
            {tableCount.toLocaleString()}
          </span>{' '}
          {tableCount === 1 ? 'table' : 'tables'}
        </>
      }
      href={buildUrl('/tables-overview', { host: hostId })}
      isLoading={isLoading}
    />
  )
}
