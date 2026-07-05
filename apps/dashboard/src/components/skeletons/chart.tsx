import { chartCard } from '@/components/charts/chart-card-styles'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type ChartSkeletonType = 'area' | 'bar' | 'line' | 'metric' | 'table'

interface ChartSkeletonProps {
  className?: string
  title?: string
  type?: ChartSkeletonType
  /** Extra classes applied to the card header — mirrors ChartCard's headerClassName so
   *  skeleton and loaded states stay pixel-identical. */
  headerClassName?: string
}

/** Area/Line chart skeleton using a beautifully simulated SVG wave */
const AreaChartSkeleton = () => (
  <div className="relative w-full h-full min-h-[140px] flex flex-col justify-between pt-4">
    {/* Grid lines */}
    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-40 py-2">
      <div className="border-b border-dashed border-border w-full" />
      <div className="border-b border-dashed border-border w-full" />
      <div className="border-b border-dashed border-border w-full" />
      <div className="w-full" />
    </div>

    {/* Simulated wave SVG with gradient sweep */}
    <div className="relative w-full h-[90px] mt-auto">
      <svg
        className="w-full h-full text-muted-foreground/15 dark:text-muted-foreground/10"
        viewBox="0 0 400 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="area-skeleton-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.8" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Wave path — explicit Q segments keep every control point inside
            the 0–100 viewBox; a smooth `T` chain reflects control points
            unboundedly and clips the curve at the top edge. */}
        <path
          d="M0,100 L0,68 Q50,22 100,52 Q150,80 200,44 Q250,22 300,58 Q350,82 400,48 L400,100 Z"
          fill="url(#area-skeleton-grad)"
        />
        {/* Wavy line stroke */}
        <path
          d="M0,68 Q50,22 100,52 Q150,80 200,44 Q250,22 300,58 Q350,82 400,48"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="opacity-40"
        />
      </svg>
    </div>

    {/* Bottom X-axis labels mock */}
    <div className="flex justify-between text-[9px] text-muted-foreground/40 mt-1 pt-1 border-t border-border/30">
      <Skeleton className="h-2 w-8" />
      <Skeleton className="h-2 w-8" />
      <Skeleton className="h-2 w-8" />
      <Skeleton className="h-2 w-8" />
    </div>
  </div>
)

/** Line chart skeleton without filled area */
const LineChartSkeleton = () => (
  <div className="relative w-full h-full min-h-[140px] flex flex-col justify-between pt-4">
    {/* Grid lines */}
    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-40 py-2">
      <div className="border-b border-dashed border-border w-full" />
      <div className="border-b border-dashed border-border w-full" />
      <div className="border-b border-dashed border-border w-full" />
      <div className="w-full" />
    </div>

    {/* Simulated wave SVG with gradient sweep */}
    <div className="relative w-full h-[90px] mt-auto">
      <svg
        className="w-full h-full text-muted-foreground/25 dark:text-muted-foreground/15"
        viewBox="0 0 400 100"
        preserveAspectRatio="none"
      >
        {/* Wavy line stroke — explicit Q segments stay inside the viewBox. */}
        <path
          d="M0,52 Q50,18 100,48 Q150,84 200,40 Q250,18 300,60 Q350,82 400,46"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        />
      </svg>
    </div>

    {/* Bottom X-axis labels mock */}
    <div className="flex justify-between text-[9px] text-muted-foreground/40 mt-1 pt-1 border-t border-border/30">
      <Skeleton className="h-2 w-8" />
      <Skeleton className="h-2 w-8" />
      <Skeleton className="h-2 w-8" />
      <Skeleton className="h-2 w-8" />
    </div>
  </div>
)

/** Bar chart skeleton with mathematical heights (static, no animation) */
const BarChartSkeleton = () => (
  <div className="w-full h-full min-h-[140px] flex flex-col justify-between pt-4">
    {/* Simulated Bars */}
    <div className="flex h-[90px] items-end justify-between gap-3 px-1 mt-auto">
      {[50, 75, 45, 90, 60, 70, 35, 85].map((height, i) => (
        <div
          key={i}
          className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end"
        >
          <Skeleton
            className="w-full rounded-t-[3px] bg-accent/40"
            style={{
              height: `${height}%`,
            }}
          />
        </div>
      ))}
    </div>

    {/* Bottom X-axis labels mock */}
    <div className="flex justify-between text-[9px] text-muted-foreground/40 mt-1.5 pt-1 border-t border-border/30">
      <Skeleton className="h-2 w-6" />
      <Skeleton className="h-2 w-6" />
      <Skeleton className="h-2 w-6" />
      <Skeleton className="h-2 w-6" />
    </div>
  </div>
)

/** KPI Metric Card Skeleton with sparkline trend outline */
const MetricCardSkeleton = () => (
  <div className="flex h-full w-full items-center justify-between py-6 px-1 gap-4">
    <div className="space-y-3 flex-1">
      <Skeleton className="h-3 w-2/5 opacity-80" />
      <div className="flex items-baseline gap-1.5">
        <Skeleton className="h-9 w-3/5 font-bold" />
        <Skeleton className="h-4 w-1/5 opacity-60" />
      </div>
      <Skeleton className="h-3.5 w-1/2 opacity-70" />
    </div>

    {/* Trend Sparkline line */}
    <div className="w-[30%] h-12 self-end pb-1 opacity-25 dark:opacity-15 text-muted-foreground">
      <svg
        className="h-full w-full"
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
      >
        <path
          d="M0,20 Q17,7 34,16 Q50,25 67,12 Q84,6 100,17"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
      </svg>
    </div>
  </div>
)

/** Tabular skeleton mirroring actual tables */
const TableSkeletonMini = () => (
  <div className="w-full h-full min-h-[140px] flex flex-col pt-1">
    {/* Simulated Table Header */}
    <div className="flex items-center gap-4 border-b border-border/60 pb-2 mb-2 px-1">
      <Skeleton className="h-3 w-1/3 opacity-80" />
      <Skeleton className="h-3 w-1/4 opacity-60" />
      <Skeleton className="h-3 w-1/5 opacity-40 ml-auto" />
    </div>

    {/* Table rows (static, no animation) */}
    <div className="space-y-3 p-1 flex-1">
      {[1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-4">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-3 w-1/5 opacity-80" />
          <Skeleton className="h-3 w-1/6 opacity-60 ml-auto" />
        </div>
      ))}
    </div>
  </div>
)

/**
 * Chart skeleton that matches actual chart dimensions & layouts
 * - Matches DynamicChart: min-h-[140px] max-h-[240px]
 * - Matches ChartCard styling: gap-2, py-2, border-border/50
 * - Supports realistic mock types to prevent Layout Shift
 */
export const ChartSkeleton = function ChartSkeleton({
  className,
  title,
  type = 'area',
  headerClassName,
}: ChartSkeletonProps = {}) {
  // Render appropriate loader based on type
  const renderContent = () => {
    switch (type) {
      case 'bar':
        return <BarChartSkeleton />
      case 'line':
        return <LineChartSkeleton />
      case 'metric':
        return <MetricCardSkeleton />
      case 'table':
        return <TableSkeletonMini />
      default:
        return <AreaChartSkeleton />
    }
  }

  return (
    // Use the SAME frame as the rendered ChartCard (variants.normal: border,
    // pt-1 pb-2, rounded-xl, gradient bg) so the card geometry is pixel-identical
    // between loading and loaded — only the inner content swaps. Mismatched
    // padding/border/radius here was the source of the load→render size flash.
    <Card
      className={cn(
        chartCard.base,
        chartCard.variants.normal,
        'min-h-[200px]',
        className
      )}
      role="status"
      aria-busy="true"
      aria-label={title ? `Loading ${title}` : 'Loading chart'}
    >
      {/* Header geometry mirrors ChartCard's header (same padding + typography)
          so the title row is the same height in both states. */}
      <CardHeader className={cn(chartCard.header, headerClassName)}>
        <header className="flex flex-row items-center justify-between gap-2">
          {title ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="truncate text-xs font-semibold tracking-wide text-foreground/90 uppercase">
                {title}
              </span>
              <span className="text-[10px] text-muted-foreground/40 font-normal lowercase shrink-0">
                (loading…)
              </span>
            </span>
          ) : (
            <Skeleton className="h-3 w-32" />
          )}
        </header>
      </CardHeader>

      <CardContent
        className={cn(chartCard.content, 'relative overflow-hidden')}
      >
        {renderContent()}
      </CardContent>
    </Card>
  )
}
