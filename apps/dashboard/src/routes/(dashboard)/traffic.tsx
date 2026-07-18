/**
 * Traffic Page
 * Route: /(dashboard)/traffic
 *
 * Quick answers to "how much data is flowing into this cluster?" —
 * last-24h ingestion KPIs plus rows/bytes/insert-query volume over time
 * (hour/day/month via the chart date-range selector), and a "Merges & Data
 * Movement" section covering merge volume, part moves, and write
 * amplification. Sources: system.query_log (uncompressed ingest) and
 * system.part_log (on-disk size, merges, and part moves).
 *
 * When the cluster actually replicates or shards, a smart-detected
 * "Replication & Distribution" section is appended (replica fetch traffic and
 * distributed initial-vs-secondary queries); it is absent on a single node.
 *
 * A conditional "PeerDB Ingestion" section is appended at the end, auto-detected
 * from system.tables / system.query_log and hidden entirely when this cluster
 * is not used as a PeerDB (Postgres CDC → ClickHouse) destination.
 */

import { CombineIcon } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { ChartBytesOnDiskOverTime } from '@/components/charts/traffic/bytes-on-disk-over-time'
import { ChartInsertPerformanceOverTime } from '@/components/charts/traffic/insert-performance-over-time'
import { ChartInsertQueriesOverTime } from '@/components/charts/traffic/insert-queries-over-time'
import { ChartInsertedBytesOverTime } from '@/components/charts/traffic/inserted-bytes-over-time'
import { ChartInsertedRowsOverTime } from '@/components/charts/traffic/inserted-rows-over-time'
import { ChartMergedBytesOverTime } from '@/components/charts/traffic/merged-bytes-over-time'
import { ChartPartMovesOverTime } from '@/components/charts/traffic/part-moves-over-time'
import { TrafficPartLogCallout } from '@/components/charts/traffic/traffic-part-log-callout'
import { TrafficPeerdbSection } from '@/components/charts/traffic/traffic-peerdb-section'
import { TrafficReplicationSection } from '@/components/charts/traffic/traffic-replication-section'
import { TrafficSettingsPopover } from '@/components/charts/traffic/traffic-settings-popover'
import { TrafficSummaryKpis } from '@/components/charts/traffic/traffic-summary-kpis'
import { usePartLogAvailability } from '@/components/charts/traffic/use-part-log-availability'
import { ChartWriteAmplificationOverTime } from '@/components/charts/traffic/write-amplification-over-time'
import { PageHeader } from '@/components/layout/page-header'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { trafficPerTableConfig } from '@/lib/query-config/traffic/per-table-ingestion'
import { useTrafficSettings } from '@/lib/traffic/traffic-settings'

const CHART_CLASS = 'h-64 min-h-0 w-full'
const CHART_CARD_CONTENT_CLASS = 'flex min-h-0 flex-1 flex-col px-3 pb-3 pt-0'

function TrafficPageContent() {
  const { settings } = useTrafficSettings()
  const { available: partLogAvailable } = usePartLogAvailability()

  // 'show'/'hide' are explicit user overrides; 'auto' follows detection.
  const resolve = (
    visibility: 'auto' | 'show' | 'hide',
    detected: boolean
  ): boolean => (visibility === 'auto' ? detected : visibility === 'show')

  const showBytesOnDisk = resolve(
    settings.sections.bytesOnDisk,
    partLogAvailable
  )
  const showMerges = resolve(settings.sections.merges, partLogAvailable)
  const showTopTables = resolve(settings.sections.topTables, partLogAvailable)

  // One callout replaces the auto-hidden part_log sections; explicit 'hide'
  // overrides suppress it (the user asked for them to be gone, not explained).
  const showPartLogCallout =
    !partLogAvailable &&
    !showBytesOnDisk &&
    !showMerges &&
    !showTopTables &&
    [
      settings.sections.bytesOnDisk,
      settings.sections.merges,
      settings.sections.topTables,
    ].includes('auto')

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader
        title="Traffic"
        description="Data flowing into the cluster: rows, bytes, and insert queries over time"
        actions={<TrafficSettingsPopover />}
      />

      <TrafficSummaryKpis />

      <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
        <ChartInsertedRowsOverTime
          chartClassName={CHART_CLASS}
          chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
        />
        <ChartInsertQueriesOverTime
          chartClassName={CHART_CLASS}
          chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
        />
        <ChartInsertPerformanceOverTime
          chartClassName={CHART_CLASS}
          chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
        />
        <ChartInsertedBytesOverTime
          chartClassName={CHART_CLASS}
          chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
        />
        {showBytesOnDisk ? (
          <ChartBytesOnDiskOverTime
            chartClassName={CHART_CLASS}
            chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
          />
        ) : null}
      </div>

      {showPartLogCallout ? <TrafficPartLogCallout /> : null}

      {showMerges ? (
        <>
          <div className="flex items-center gap-2">
            <CombineIcon
              className="size-4 text-muted-foreground"
              strokeWidth={1.5}
            />
            <h2 className="text-sm font-medium text-foreground">
              Merges &amp; Data Movement
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
            <ChartMergedBytesOverTime
              chartClassName={CHART_CLASS}
              chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
            />
            <ChartPartMovesOverTime
              chartClassName={CHART_CLASS}
              chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
            />
            <ChartWriteAmplificationOverTime
              chartClassName={CHART_CLASS}
              chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
            />
          </div>
        </>
      ) : null}

      {showTopTables ? (
        <PageLayout
          queryConfig={trafficPerTableConfig}
          title="Top Tables by Ingestion (24h)"
        />
      ) : null}

      <TrafficReplicationSection
        chartClassName={CHART_CLASS}
        chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
        visibility={settings.sections.replication}
      />

      <TrafficPeerdbSection
        chartClassName={CHART_CLASS}
        chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
        visibility={settings.sections.peerdb}
      />
    </div>
  )
}

function TrafficPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TrafficPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/traffic')({
  component: TrafficPage,
  head: () => pageOgHead('traffic'),
})
