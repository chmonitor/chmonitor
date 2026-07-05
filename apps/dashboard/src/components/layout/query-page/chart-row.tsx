/**
 * ChartRow Component
 *
 * Renders a collapsible row of charts with inline chevron toggle.
 *
 * Features:
 * - Inline chevron toggle (▶/▼) with smooth rotation animation
 * - Responsive grid layout (1→2→4 columns) when expanded
 * - Collapsed state shows "Row N (X charts)" label
 * - Uses Radix Collapsible for smooth animations
 * - Equal height cards via auto-rows-fr grid
 */

import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

import type { QueryConfig } from '@/types/query-config'

import { ChartRowSummary } from './chart-row-summary'
import { DynamicChart } from './dynamic-chart'
import { Suspense } from 'react'
import { ChartSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

type ChartConfig = NonNullable<QueryConfig['relatedCharts']>[number]

/** Check if any chart in the list has a colSpan defined */
function hasColSpan(charts: ChartConfig[]): boolean {
  return charts.some((c) => {
    if (!c || c === 'break') return false
    const props = Array.isArray(c) ? c[1] : undefined
    return props && typeof props === 'object' && 'colSpan' in props
  })
}

export interface ChartRowProps {
  rowIndex: number
  charts: ChartConfig[]
  isCollapsed: boolean
  onToggle: () => void
}

export const ChartRow = function ChartRow({
  rowIndex: _rowIndex,
  charts,
  isCollapsed,
  onToggle,
}: ChartRowProps) {
  // Filter out 'break' directives for counting
  const chartCount = charts.filter((c) => c && c !== 'break').length

  if (chartCount === 0) {
    return null
  }

  return (
    <Collapsible open={!isCollapsed} onOpenChange={onToggle}>
      <div className="group relative">
        {/* Collapsed state - compact chart summaries, click to expand */}
        {isCollapsed && (
          <CollapsibleTrigger
            render={
              <div className="group/row relative flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-dashed bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer px-3" />
            }
          >
            <ChartRowSummary charts={charts} />
            <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground opacity-0 group-hover/row:opacity-100 transition-opacity duration-200">
              Show
              <ChevronDownIcon className="size-3" />
            </span>
          </CollapsibleTrigger>
        )}

        {/* Expanded state - charts grid */}
        <CollapsibleContent>
          {!isCollapsed && (
            <div className="relative group pb-6 overflow-hidden">
              <div
                className={cn(
                  'grid gap-3 w-full min-w-0 overflow-hidden items-stretch',
                  // Single chart: full width (1-column grid)
                  chartCount === 1
                    ? 'grid-cols-1 auto-rows-[minmax(200px,auto)]'
                    : hasColSpan(charts)
                      ? 'grid-cols-1 md:grid-cols-10 auto-rows-[minmax(200px,auto)]'
                      : 'grid-cols-1 md:grid-cols-2 auto-rows-[minmax(200px,auto)]'
                )}
              >
                {charts.map((chartConfig, index) => {
                  if (!chartConfig) return null

                  // Handle break directive
                  if (
                    typeof chartConfig === 'string' &&
                    chartConfig === 'break'
                  ) {
                    return <div key={`break-${index}`} className="hidden" />
                  }

                  // Extract chart name and props
                  const chartName = Array.isArray(chartConfig)
                    ? chartConfig[0]
                    : chartConfig
                  const chartProps = Array.isArray(chartConfig)
                    ? chartConfig[1] || {}
                    : {}

                  // Get colSpan from props (default to full width on mobile, half on desktop)
                  const colSpan = (chartProps as { colSpan?: number }).colSpan

                  return (
                    <div
                      key={`${chartName}-${index}`}
                      className={cn(
                        'h-full min-w-0',
                        colSpan && `md:col-span-${colSpan}`
                      )}
                      style={
                        colSpan
                          ? { gridColumn: `span ${colSpan} / span ${colSpan}` }
                          : undefined
                      }
                    >
                      <div className="flex h-full w-full min-w-0 flex-col">
                        <Suspense fallback={<ChartSkeleton />}>
                          <DynamicChart
                            chartName={chartName}
                            chartProps={chartProps}
                          />
                        </Suspense>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Hide pill - bottom center, shows on hover */}
              <CollapsibleTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'absolute z-50 h-6 px-3 gap-1',
                      'bottom-2 left-1/2 -translate-x-1/2',
                      'opacity-0 group-hover:opacity-100 transition-opacity duration-200',
                      'bg-muted hover:bg-muted/80 text-muted-foreground',
                      'rounded-full text-xs'
                    )}
                    aria-label="Collapse row"
                  />
                }
              >
                <ChevronUpIcon className="size-3" />
                <span>Hide</span>
              </CollapsibleTrigger>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
