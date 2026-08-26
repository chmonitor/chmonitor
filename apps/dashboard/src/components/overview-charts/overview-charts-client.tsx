import { ClickHouseInfoCard } from './clickhouse-info-card'
import { DatabaseTableCountCard } from './database-table-count-card'
import { DiskSizeCard } from './disk-size-card'
import { RunningQueriesCard } from './running-queries-card'
import { cn } from '@/lib/utils'

// ============================================================================
// OverviewCharts Component
// ============================================================================

/**
 * Overview KPI strip: 1 column on phones, 2×2 from `sm`, four-across from `lg`.
 * `md:grid-cols-4` (768) crushes titles like "Active Queries" and collides
 * value + unit; `/traffic` uses the same 1 / 2 / 4 split.
 */
export const OVERVIEW_KPI_GRID_CLASS =
  'grid auto-rows-fr grid-cols-1 gap-2 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4'

/**
 * OverviewCharts - Main grid component for overview metrics
 * Displays 4 cards: Running/Today Queries, Databases/Tables, Disk Usage, Version
 */

interface OverviewChartsProps {
  className?: string
}

export const OverviewCharts = function OverviewCharts({
  className,
}: OverviewChartsProps) {
  return (
    <div
      className={cn(OVERVIEW_KPI_GRID_CLASS, className)}
      role="region"
      aria-label="Overview metrics"
    >
      <RunningQueriesCard />
      <DatabaseTableCountCard />
      <DiskSizeCard />
      <ClickHouseInfoCard />
    </div>
  )
}
