import { ClickHouseInfoCard } from './clickhouse-info-card'
import { DatabaseTableCountCard } from './database-table-count-card'
import { DiskSizeCard } from './disk-size-card'
import { RunningQueriesCard } from './running-queries-card'
import { cn } from '@/lib/utils'

// ============================================================================
// OverviewCharts Component
// ============================================================================

/**
 * Overview KPI strip: 1 column on phones, 2×2 from `sm`, four-across from `xl`.
 * `md:grid-cols-4` (768) and `lg:grid-cols-4` (1024) both crush: at `lg` the
 * 16rem sidebar docks, so the content pane is still ~768px. Four-across waits
 * until `xl` (1280) so "Active Queries" stays one line.
 */
export const OVERVIEW_KPI_GRID_CLASS =
  'grid auto-rows-fr grid-cols-1 gap-2 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4'

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
