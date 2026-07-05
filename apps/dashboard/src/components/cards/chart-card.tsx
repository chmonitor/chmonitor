import { ArrowUpRight, ScalingIcon } from 'lucide-react'

import type { ComponentPropsWithoutRef } from 'react'
import type { CardToolbarMetadata } from '@/components/cards/card-toolbar'
import type { DateRangeConfig, DateRangeValue } from '@/components/date-range'
import type { StaleError } from '@/lib/swr'
import type { ChartDataPoint } from '@/types/chart-data'

import { CardToolbar } from '@/components/cards/card-toolbar'
import { chartCard } from '@/components/charts/chart-card-styles'
import {
  ChartScaleProvider,
  useChartScale,
} from '@/components/charts/chart-scale-context'
import { ChartStaleIndicator } from '@/components/charts/chart-stale-indicator'
import { DateRangeSelector } from '@/components/date-range'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ExpandableText } from '@/components/utilities/expandable-text'
import { useRouter } from '@/lib/next-compat'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

/**
 * Log scale toggle button - visible icon next to date range
 * Matches hover behavior of other header icons
 */
function ScaleToggle() {
  const scaleContext = useChartScale()

  if (!scaleContext) return null

  const { isLogScale, toggleScale } = scaleContext

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleScale}
            aria-label={isLogScale ? 'Disable log scale' : 'Enable log scale'}
            className={cn(
              'size-6 rounded-full transition-opacity',
              'relative before:content-[""] before:absolute before:-inset-4',
              'opacity-0 group-hover:opacity-40 hover:!opacity-100',
              isLogScale && 'text-amber-500 group-hover:opacity-70'
            )}
          />
        }
      >
        <ScalingIcon className="size-3.5" strokeWidth={2} />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isLogScale
          ? 'Log scale (click to disable)'
          : 'Linear scale (click for log)'}
      </TooltipContent>
    </Tooltip>
  )
}

interface ChartCardProps
  extends Omit<ComponentPropsWithoutRef<typeof Card>, 'children' | 'title'> {
  title?: string | React.ReactNode
  contentClassName?: string
  sql?: string
  data?: ChartDataPoint[]
  /** Query execution metadata */
  metadata?: CardToolbarMetadata
  children: string | React.ReactNode
  /** Date range configuration (opt-in feature) */
  dateRangeConfig?: DateRangeConfig
  /** Current selected range value */
  currentRange?: string
  /** Callback when date range changes */
  onRangeChange?: (range: DateRangeValue) => void
  /** Error from failed revalidation (data is stale) */
  staleError?: StaleError
  /** Callback to retry fetch (used with staleError) */
  onRetry?: () => void
  /** Enable log scale toggle (default: true for numeric charts) */
  enableScaleToggle?: boolean
  /** Optional zoom button to render in header */
  zoomButton?: React.ReactNode
  /** Optional icon rendered before the title */
  icon?: React.ReactNode
  /** Optional className override for the header */
  headerClassName?: string
  /** Navigation target URL when clicked */
  href?: string
}

/**
 * Inner card content. Renders ScaleToggle unconditionally — it self-nullifies
 * (returns null) when no ChartScaleProvider is present, so the same component
 * serves both the scale-enabled and scale-disabled paths (see ChartCard).
 */
function ChartCardContent({
  title,
  icon,
  headerClassName,
  sql,
  data,
  metadata,
  className,
  contentClassName,
  children,
  dateRangeConfig,
  currentRange,
  onRangeChange,
  staleError,
  onRetry,
  zoomButton,
  href,
  ...cardProps
}: ChartCardProps) {
  const router = useRouter()
  const hostId = useHostId()

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!href) return

    const target = e.target as HTMLElement
    const isInteractive = target.closest(
      'button, a, select, input, [role="button"], [role="menuitem"], [role="tab"], .interactive-element'
    )

    if (isInteractive) {
      return
    }

    router.push(`${href}${href.includes('?') ? '&' : '?'}host=${hostId}`)
  }

  return (
    <Card
      className={cn(chartCard.base, chartCard.variants.normal, className)}
      {...cardProps}
    >
      {title ? (
        <CardHeader className={cn(chartCard.header, headerClassName)}>
          <header className="flex flex-row items-center justify-between gap-2">
            <div
              className={cn(
                'flex items-center gap-1.5 min-w-0 flex-1 group/title',
                href && 'cursor-pointer'
              )}
              onClick={href ? handleCardClick : undefined}
            >
              {icon && <span className="shrink-0">{icon}</span>}
              <ExpandableText
                variant="popover"
                maxLines={1}
                className={cn(
                  'text-xs font-semibold tracking-wide text-foreground/90 uppercase min-w-0 flex-1 transition-colors duration-200',
                  href && 'group-hover/title:text-primary'
                )}
              >
                {title}
              </ExpandableText>
              {href && (
                <ArrowUpRight className="size-3.5 opacity-0 -translate-x-1 translate-y-1 group-hover/title:opacity-60 group-hover/title:translate-x-0 group-hover/title:translate-y-0 transition-all duration-300 text-muted-foreground shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {staleError && onRetry && (
                <ChartStaleIndicator error={staleError} onRetry={onRetry} />
              )}
              <ScaleToggle />
              {zoomButton}
              {dateRangeConfig && onRangeChange && (
                <DateRangeSelector
                  config={dateRangeConfig}
                  value={currentRange ?? dateRangeConfig.defaultValue}
                  onChange={onRangeChange}
                />
              )}
              <CardToolbar
                sql={sql}
                data={data}
                metadata={metadata}
                filename={typeof title === 'string' ? title : undefined}
              />
            </div>
          </header>
        </CardHeader>
      ) : null}

      <CardContent
        className={cn(chartCard.content, 'overflow-hidden', contentClassName)}
      >
        {children}
      </CardContent>
    </Card>
  )
}

export const ChartCard = function ChartCard({
  enableScaleToggle = true,
  ...props
}: ChartCardProps) {
  // Scale-enabled charts get a ChartScaleProvider so the log/linear toggle
  // works; otherwise ChartCardContent's ScaleToggle self-nullifies (no context).
  if (enableScaleToggle) {
    return (
      <ChartScaleProvider>
        <ChartCardContent {...props} />
      </ChartScaleProvider>
    )
  }

  return <ChartCardContent {...props} />
}
