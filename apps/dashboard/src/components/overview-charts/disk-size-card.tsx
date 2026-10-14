import { HardDrive } from 'lucide-react'

import type { CardVariant } from './card-styles'

import { KpiCard } from './kpi-card'
import { formatReadableSize } from '@/lib/format-readable'
import { useChartData } from '@/lib/query/use-chart-data'
import { REFRESH_INTERVAL, useHostId } from '@/lib/swr'
import { buildUrl } from '@/lib/url/url-builder'

/**
 * DiskSizeCard - "Storage" overview KPI.
 * Headline is the used size; a progress bar and `used / total / free`
 * breakdown sit below. Bar color escalates past 75% / 90% usage.
 */

export const DiskSizeCard = function DiskSizeCard() {
  const hostId = useHostId()
  const swr = useChartData<{
    name: string
    used_space: number
    readable_used_space: string
    total_space: number
    readable_total_space: string
  }>({
    chartName: 'disk-size-single',
    hostId,
    refreshInterval: REFRESH_INTERVAL.SLOW_2M,
  })

  const isLoading = swr.isLoading
  const used = swr.data?.[0]?.used_space ?? 0
  const total = swr.data?.[0]?.total_space ?? 1
  const readableUsed = swr.data?.[0]?.readable_used_space ?? '-'
  const readableTotal = swr.data?.[0]?.readable_total_space ?? '-'
  const percent = total > 0 ? (used / total) * 100 : 0
  const free = Math.max(0, total - used)

  const variant: CardVariant =
    percent > 90 ? 'danger' : percent > 75 ? 'warning' : 'default'

  return (
    <KpiCard
      icon={HardDrive}
      tone="blue"
      label="Storage"
      value={readableUsed}
      progress={percent}
      progressVariant={variant}
      sub={
        <>
          <span className="tabular-nums">{percent.toFixed(0)}%</span> of{' '}
          <span className="tabular-nums">{readableTotal}</span> ·{' '}
          <span className="tabular-nums">{formatReadableSize(free)}</span> free
        </>
      }
      href={buildUrl('/disks', { host: hostId })}
      isLoading={isLoading}
    />
  )
}
