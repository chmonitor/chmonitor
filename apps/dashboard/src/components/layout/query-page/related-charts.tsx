/**
 * RelatedCharts Component
 *
 * Renders a responsive grid of charts based on queryConfig.relatedCharts.
 *
 * Layout behavior:
 * - 1-4 charts (single row): Standard responsive grid, no row controls
 * - 5+ charts (multiple rows): Grouped into rows of 4 with inline chevron toggles
 *
 * Responsive layout per row:
 * - Mobile: 1 column (stacked)
 * - MacBook (md): 2 columns
 * - Large screen (xl): 4 columns
 *
 * Equal card heights achieved with h-full on grid items.
 */

import type { QueryConfig } from '@/types/query-config'

import { ChartRow } from './chart-row'
import { groupChartsIntoRows } from './utils'
import { cn } from '@/lib/utils'

export interface RelatedChartsProps {
  relatedCharts: QueryConfig['relatedCharts']
  gridClass?: string
  /** Whether a given row index is collapsed (only used for multi-row layout) */
  isRowCollapsed?: (rowIndex: number) => boolean
  /** Callback to toggle a specific row (only used for multi-row layout) */
  onToggleRow?: (rowIndex: number) => void
}

export const RelatedCharts = function RelatedCharts({
  relatedCharts,
  gridClass,
  isRowCollapsed,
  onToggleRow,
}: RelatedChartsProps) {
  if (!relatedCharts || relatedCharts.length === 0) {
    return null
  }

  // Filter out 'break' directives and null values
  const validCharts = relatedCharts.filter((c) => c && c !== 'break')

  // Always group into rows with toggle controls
  const rows = groupChartsIntoRows(validCharts)

  return (
    <div className={cn('flex flex-col gap-2 pb-2 w-full min-w-0', gridClass)}>
      {rows.map((rowCharts, rowIndex) => (
        <ChartRow
          key={`row-${rowIndex}`}
          rowIndex={rowIndex}
          charts={rowCharts}
          isCollapsed={isRowCollapsed?.(rowIndex) ?? false}
          onToggle={() => onToggleRow?.(rowIndex)}
        />
      ))}
    </div>
  )
}
