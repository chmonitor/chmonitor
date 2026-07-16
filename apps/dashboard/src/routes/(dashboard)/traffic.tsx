/**
 * Traffic Page
 * Route: /(dashboard)/traffic
 *
 * Quick answers to "how much data is flowing into this cluster?" —
 * last-24h ingestion KPIs plus rows/bytes/insert-query volume over time
 * (hour/day/month via the chart date-range selector). Sources:
 * system.query_log (uncompressed ingest) and system.part_log (on-disk size).
 */

import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { ChartBytesOnDiskOverTime } from '@/components/charts/traffic/bytes-on-disk-over-time'
import { ChartInsertQueriesOverTime } from '@/components/charts/traffic/insert-queries-over-time'
import { ChartInsertedBytesOverTime } from '@/components/charts/traffic/inserted-bytes-over-time'
import { ChartInsertedRowsOverTime } from '@/components/charts/traffic/inserted-rows-over-time'
import { TrafficSummaryKpis } from '@/components/charts/traffic/traffic-summary-kpis'
import { PageHeader } from '@/components/layout/page-header'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'

const CHART_CLASS = 'h-64 min-h-0 w-full'
const CHART_CARD_CONTENT_CLASS = 'flex min-h-0 flex-1 flex-col px-3 pb-3 pt-0'

function TrafficPageContent() {
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader
        title="Traffic"
        description="Data flowing into the cluster: rows, bytes, and insert queries over time"
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
        <ChartInsertedBytesOverTime
          chartClassName={CHART_CLASS}
          chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
        />
        <ChartBytesOnDiskOverTime
          chartClassName={CHART_CLASS}
          chartCardContentClassName={CHART_CARD_CONTENT_CLASS}
        />
      </div>
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
