import type { ReactNode } from 'react'
import type { CardToolbarMetadata } from '@/components/cards/card-toolbar'
import type { DateRangeConfig, DateRangeValue } from '@/components/date-range'
import type { StaleError, UseChartResult } from '@/lib/swr'
import type { ChartDataPoint } from '@/types/chart-data'
import type { ChartSkeletonType } from './chart-registry'

import { ChartEmpty } from './chart-empty'
import { ChartError } from './chart-error'
import { getChartSkeletonType } from './chart-registry'
import { ChartZoomButton, ChartZoomDialog } from './chart-zoom-dialog'
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { ChartSkeleton } from '@/components/skeletons'
import { FadeIn } from '@/components/ui/fade-in'
import { trackEvent } from '@/lib/analytics/analytics'
import { cn } from '@/lib/utils'

// Fires at most once per page load — an activation signal for "the user saw a
// live chart render with real data," not a per-chart-mount counter (this
// component mounts 30+ times across the app).
let firstChartRenderTracked = false

export interface ChartContainerProps<
  TData extends ChartDataPoint = ChartDataPoint,
> {
  /** SWR response from useChartData hook */
  swr: UseChartResult<TData>
  /** Chart title for skeleton/error/empty states */
  title?: string
  /** Container className */
  className?: string
  /** Chart className */
  chartClassName?: string
  /**
   * Children render function receives data, sql, metadata, staleError, and mutate
   * staleError is set when revalidation fails but previous data exists
   */
  children: (
    data: TData[],
    sql: string | undefined,
    metadata: CardToolbarMetadata | undefined,
    staleError: StaleError | undefined,
    mutate: () => Promise<unknown>
  ) => ReactNode
  /** Use compact layout for smaller charts */
  compact?: boolean
  /** Enable zoom dialog (default: true) */
  enableZoom?: boolean
  /** Date range configuration for zoom dialog */
  dateRangeConfig?: DateRangeConfig
  /** Current selected range value */
  currentRange?: string
  /** Callback when date range changes */
  onRangeChange?: (range: DateRangeValue) => void
  /** Skeleton type hint (auto-detected from chart name if omitted) */
  type?: ChartSkeletonType
}

/**
 * ChartContainer - Unified chart loading state handler
 *
 * Eliminates duplicate loading/error/empty state handling across 32+ chart components.
 *
 * @example
 * ```tsx
 * export function MyChart({ hostId, title }: ChartProps) {
 *   const swr = useChartData<{ value: number }>({
 *     chartName: 'my-chart',
 *     hostId,
 *   })
 *
 *   return (
 *     <ChartContainer swr={swr} title={title} className="w-full">
 *       {(data, sql, metadata) => (
 *         <ChartCard title={title} sql={sql} data={data} metadata={metadata}>
 *           <AreaChart data={data} index="time" categories={['value']} />
 *         </ChartCard>
 *       )}
 *     </ChartContainer>
 *   )
 * }
 * ```
 */
export function ChartContainer<TData extends ChartDataPoint = ChartDataPoint>({
  swr,
  title,
  className,
  chartClassName: _chartClassName,
  children,
  compact: _compact = false,
  enableZoom = true,
  dateRangeConfig,
  currentRange,
  onRangeChange,
  type,
}: ChartContainerProps<TData>) {
  const { data, isLoading, error, mutate, sql, metadata, hasData, staleError } =
    swr
  const [zoomOpen, setZoomOpen] = useState(false)

  const hasRenderableData = Boolean(data && data.length > 0)
  useEffect(() => {
    if (hasRenderableData && !firstChartRenderTracked) {
      firstChartRenderTracked = true
      trackEvent('first_chart_render')
    }
  }, [hasRenderableData])

  // Resolve skeleton type: explicit prop, or dynamic lookup from registry, or fallback
  const skeletonType = (() => {
    if (type) return type
    if (swr.chartName) {
      return getChartSkeletonType(swr.chartName)
    }
    return 'area'
  })()

  // Stable retry handler to prevent re-renders in ChartError
  const handleRetry = useCallback(() => {
    mutate()
  }, [mutate])

  // Pass all metadata fields dynamically
  const toolbarMetadata: CardToolbarMetadata | undefined = useMemo(
    () => (metadata ? { ...metadata } : undefined),
    [metadata]
  )

  // Render chart content (called once, before early returns to satisfy hook rules)
  const chartContent =
    data && data.length > 0
      ? children(data, sql, toolbarMetadata, staleError, mutate)
      : null

  // Extract raw chart content (without ChartCard wrapper) for zoom dialog
  const dialogContent = (() => {
    if (!isValidElement(chartContent)) return chartContent
    return (
      (chartContent.props as { children?: ReactNode }).children ?? chartContent
    )
  })()

  // Loading state
  if (isLoading) {
    return (
      <ChartSkeleton title={title} type={skeletonType} className={className} />
    )
  }

  // Error state - ONLY when no previous data exists (initial load error)
  // If we have data but error occurred during revalidation, show data with stale indicator
  if (error && !hasData) {
    return <ChartError error={error} title={title} onRetry={handleRetry} />
  }

  // Empty state - show empty state message instead of hiding
  if (!data || data.length === 0) {
    return (
      <ChartEmpty
        title={title}
        className={className}
        compact={_compact}
        sql={sql}
        metadata={metadata}
      />
    )
  }

  // If children returns a valid element, inject zoomButton prop if it's a ChartCard
  const enhancedContent =
    enableZoom &&
    isValidElement(chartContent) &&
    (chartContent.props as Record<string, unknown>).zoomButton === undefined
      ? cloneElement(chartContent, {
          zoomButton: <ChartZoomButton onClick={() => setZoomOpen(true)} />,
        } as Record<string, unknown>)
      : chartContent

  return (
    <>
      <FadeIn className="h-full w-full min-w-0">
        <div
          className={cn('h-full w-full min-w-0 overflow-hidden', className)}
          aria-label={title ? `${title} chart` : 'Chart'}
          role="region"
        >
          {enhancedContent}
        </div>
      </FadeIn>
      {enableZoom && zoomOpen && (
        <ChartZoomDialog
          open={zoomOpen}
          onOpenChange={setZoomOpen}
          title={title}
          sql={sql}
          data={data}
          metadata={toolbarMetadata}
          dateRangeConfig={dateRangeConfig}
          currentRange={currentRange}
          onRangeChange={onRangeChange}
          staleError={staleError}
          onRetry={staleError ? mutate : undefined}
          className={_chartClassName}
        >
          {dialogContent}
        </ChartZoomDialog>
      )}
    </>
  )
}
