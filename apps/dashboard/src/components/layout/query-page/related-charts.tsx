import type { QueryConfig } from '@/types/query-config'

import { ChartRow } from './chart-row'
import { groupChartsIntoRows } from './utils'
import { cn } from '@/lib/utils'

export interface RelatedChartsProps {
  relatedCharts: QueryConfig['relatedCharts']
  gridClass?: string
  isRowCollapsed?: (rowIndex: number) => boolean
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

  const validCharts = relatedCharts.filter((c) => c && c !== 'break')

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
