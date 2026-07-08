import type { ReactNode } from 'react'
import type { CardToolbarMetadata } from '@/components/cards/card-toolbar'
import type { ChartDataPoint } from '@/types/chart-data'

import { ChartCard } from '@/components/cards/chart-card'
import { ChartEmpty } from '@/components/charts/chart-empty'
import { ChartSkeleton } from '@/components/skeletons/chart'

/** Skeleton shown while a stat's chart data is loading. */
export function statLoading(title: string) {
  return (
    <ChartSkeleton
      title={title}
      type="stat"
      className="min-h-[72px]"
      headerClassName="py-1"
    />
  )
}

/** Empty / error state shown when a stat has no data. */
export function statEmpty(
  title: string,
  sql: string | undefined,
  data: ChartDataPoint[] | undefined,
  metadata: CardToolbarMetadata | undefined
) {
  return (
    <ChartEmpty
      title={title}
      sql={sql}
      data={data}
      metadata={metadata}
      compact
      className="min-h-[72px]"
      headerClassName="py-1"
    />
  )
}

interface StatCardProps {
  title: string
  icon: ReactNode
  value: ReactNode
  subtitle?: ReactNode
  sql: string | undefined
  data: ChartDataPoint[] | undefined
  metadata: CardToolbarMetadata | undefined
}

/**
 * One insight stat — a compact {@link ChartCard} with a headline value and an
 * optional muted subtitle. Shared by every stat on the insights page so they
 * stay visually identical.
 */
export function StatCard({
  title,
  icon,
  value,
  subtitle,
  sql,
  data,
  metadata,
}: StatCardProps) {
  return (
    <ChartCard
      title={title}
      icon={icon}
      sql={sql}
      data={data}
      metadata={metadata}
      enableScaleToggle={false}
      headerClassName="py-1"
      contentClassName="min-h-[60px]"
    >
      <div className="text-xl font-bold tracking-tight truncate">{value}</div>
      {subtitle !== undefined && (
        <div className="mt-0.5 text-xs text-muted-foreground truncate">
          {subtitle}
        </div>
      )}
    </ChartCard>
  )
}
