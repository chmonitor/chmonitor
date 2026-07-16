import { memo } from 'react'
import { ChartPeerdbRowsOverTime } from '@/components/charts/traffic/peerdb-rows-over-time'
import { PeerDBLogo } from '@/components/icons/peerdb-brand-logo'
import { REFRESH_INTERVAL, useChartData, useHostId } from '@/lib/swr'

interface PeerdbDetectRow {
  peerdb_tables: number
  peerdb_inserts_24h: number
  [key: string]: unknown
}

/**
 * Conditional "PeerDB Ingestion" section for /traffic. Auto-detects whether the
 * cluster is used as a PeerDB (Postgres CDC → ClickHouse) destination via
 * `traffic-peerdb-detect`; when no PeerDB tables or recent PeerDB insert
 * activity is found, the whole section is hidden (renders null). Detection is
 * cheap and fail-soft — errors also hide the section.
 */
export const TrafficPeerdbSection = memo(function TrafficPeerdbSection({
  chartClassName,
  chartCardContentClassName,
}: {
  chartClassName?: string
  chartCardContentClassName?: string
}) {
  const hostId = useHostId()

  const detect = useChartData<PeerdbDetectRow>({
    chartName: 'traffic-peerdb-detect',
    hostId,
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
  })

  const row = detect.data?.[0]

  if (detect.isLoading || detect.error || !row) return null
  if (
    Number(row.peerdb_tables ?? 0) === 0 &&
    Number(row.peerdb_inserts_24h ?? 0) === 0
  ) {
    return null
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex items-center gap-2">
        <PeerDBLogo className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">
          PeerDB Ingestion
        </h2>
      </div>
      <ChartPeerdbRowsOverTime
        chartClassName={chartClassName}
        chartCardContentClassName={chartCardContentClassName}
      />
    </div>
  )
})

export default TrafficPeerdbSection
