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
    <div className="flex flex-col gap-4">
      {/* Global percentile toggle */}
      <div className="flex items-center justify-end">
        <PercentileSelector value={percentile} onChange={setPercentile} />
      </div>

      {/* Record Breakers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <SectionLabel title="Record Breakers" />
        <LargestScanStat hostId={hostId} lastHours={lastHours} />
        <FastestScanStat hostId={hostId} lastHours={lastHours} />
        <LongestQueryStat hostId={hostId} lastHours={lastHours} />
        <TotalStorageStat hostId={hostId} />
      </div>

      {/* Query Insights */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <SectionLabel title="Query Insights" />
        <TotalQueriesStat hostId={hostId} lastHours={lastHours} />
        <TotalScannedStat hostId={hostId} lastHours={lastHours} />
        <TotalRowsReadStat hostId={hostId} lastHours={lastHours} />
        <PeakMemoryStat hostId={hostId} lastHours={lastHours} />
      </div>

      {/* Cluster Activity */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <SectionLabel title="Cluster Activity" />
        <ActiveQueriesStat hostId={hostId} />
        <CurrentMemoryStat hostId={hostId} />
        <HttpConnectionsStat hostId={hostId} />
        <ActiveMergesStat hostId={hostId} />
      </div>

      {/* Storage & Operations */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <SectionLabel title="Storage &amp; Operations" />
        <ActivePartsStat hostId={hostId} />
        <DetachedPartsStat hostId={hostId} />
        <ActiveMutationsStat hostId={hostId} />
      </div>

      {/* Traffic Patterns */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <SectionLabel title="Traffic Patterns" />
        <BusiestDayQueriesStat hostId={hostId} lastHours={lastHours} />
        <BusiestDayBytesStat hostId={hostId} lastHours={lastHours} />
        <BusiestSecondStat hostId={hostId} lastHours={lastHours} />
        <AvgDurationStat
          hostId={hostId}
          lastHours={lastHours}
          percentile={percentile}
        />
      </div>

      {/* Error Rate */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <ErrorRateStat hostId={hostId} lastHours={lastHours} />
      </div>
    </div>
  )
}
