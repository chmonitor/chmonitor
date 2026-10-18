import {
  ActiveMergesStat,
  ActiveMutationsStat,
  ActivePartsStat,
  ActiveQueriesStat,
  CurrentMemoryStat,
  DetachedPartsStat,
  HttpConnectionsStat,
} from './activity-stats'
import {
  PeakMemoryStat,
  TotalQueriesStat,
  TotalRowsReadStat,
  TotalScannedStat,
} from './query-stats'
import {
  FastestScanStat,
  LargestScanStat,
  LongestQueryStat,
  TotalStorageStat,
} from './record-stats'
import {
  AvgDurationStat,
  BusiestDayBytesStat,
  BusiestDayQueriesStat,
  BusiestSecondStat,
  ErrorRateStat,
  PercentileSelector,
} from './traffic-stats'
import { useState } from 'react'
import { ChartGroupingProvider } from '@/lib/query/use-chart-grouping'

function SectionLabel({ title }: { readonly title: string }) {
  return (
    <div className="col-span-full text-xs font-semibold text-muted-foreground tracking-wider uppercase">
      {title}
    </div>
  )
}

export function StatsGrid({
  hostId,
  lastHours,
}: {
  readonly hostId: number
  readonly lastHours?: number
}) {
  const [percentile, setPercentile] = useState('99')

  return (
    <ChartGroupingProvider
      groupingId="insights-stats"
      hostId={hostId}
      lastHours={lastHours}
      params={{ percentile }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-end">
          <PercentileSelector value={percentile} onChange={setPercentile} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <SectionLabel title="Record Breakers" />
          <LargestScanStat percentile={percentile} />
          <FastestScanStat percentile={percentile} />
          <LongestQueryStat percentile={percentile} />
          <TotalStorageStat />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <SectionLabel title="Query Insights" />
          <TotalQueriesStat percentile={percentile} />
          <TotalScannedStat percentile={percentile} />
          <TotalRowsReadStat percentile={percentile} />
          <PeakMemoryStat percentile={percentile} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <SectionLabel title="Cluster Activity" />
          <ActiveQueriesStat />
          <CurrentMemoryStat />
          <HttpConnectionsStat />
          <ActiveMergesStat />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <SectionLabel title="Storage &amp; Operations" />
          <ActivePartsStat />
          <DetachedPartsStat />
          <ActiveMutationsStat />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <SectionLabel title="Traffic Patterns" />
          <BusiestDayQueriesStat />
          <BusiestDayBytesStat />
          <BusiestSecondStat />
          <AvgDurationStat percentile={percentile} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <ErrorRateStat />
        </div>
      </div>
    </ChartGroupingProvider>
  )
}
