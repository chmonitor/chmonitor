import type { TrafficSectionDensity } from '@/lib/traffic/traffic-settings'

import { memo } from 'react'
import { ChartPeerdbBytesOverTime } from '@/components/charts/traffic/peerdb-bytes-over-time'
import { ChartPeerdbPerformanceOverTime } from '@/components/charts/traffic/peerdb-performance-over-time'
import { ChartPeerdbRowsOverTime } from '@/components/charts/traffic/peerdb-rows-over-time'
import { TrafficSectionHeader } from '@/components/charts/traffic/traffic-section-header'
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
  visibility = 'auto',
  density = 'full',
  onToggleDensity,
}: {
  chartClassName?: string
  chartCardContentClassName?: string
  /**
   * View-settings override: 'hide' removes the section, 'show' forces it
   * (skipping detection), 'auto' (default) keeps the PeerDB smart detection.
   */
  visibility?: 'auto' | 'show' | 'hide'
  /** Full chart grid vs compact mini-chart row (default 'full'). */
  density?: TrafficSectionDensity
  onToggleDensity?: () => void
}) {
  const hostId = useHostId()

  const detect = useChartData<PeerdbDetectRow>({
    chartName: 'traffic-peerdb-detect',
    hostId,
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
  })

  if (visibility === 'hide') return null

  const row = detect.data?.[0]

  if (visibility !== 'show') {
    if (detect.isLoading || detect.error || !row) return null
    if (
      Number(row.peerdb_tables ?? 0) === 0 &&
      Number(row.peerdb_inserts_24h ?? 0) === 0
    ) {
      return null
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {onToggleDensity ? (
        <TrafficSectionHeader
          icon={<PeerDBLogo className="size-4 text-muted-foreground" />}
          title="PeerDB Ingestion"
          density={density}
          onToggleDensity={onToggleDensity}
        />
      ) : (
        <div className="flex items-center gap-2">
          <PeerDBLogo className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">
            PeerDB Ingestion
          </h2>
        </div>
      )}
      <div
        className={
          density === 'compact'
            ? 'grid grid-cols-2 gap-2 lg:grid-cols-3'
            : 'grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2'
        }
      >
        <ChartPeerdbRowsOverTime
          chartClassName={chartClassName}
          chartCardContentClassName={chartCardContentClassName}
        />
        <ChartPeerdbBytesOverTime
          chartClassName={chartClassName}
          chartCardContentClassName={chartCardContentClassName}
        />
        <ChartPeerdbPerformanceOverTime
          chartClassName={chartClassName}
          chartCardContentClassName={chartCardContentClassName}
        />
      </div>
    </div>
  )
})

export default TrafficPeerdbSection
