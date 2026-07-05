import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Settings2,
  Sparkles,
} from 'lucide-react'

import { useCallback, useEffect, useRef, useState } from 'react'
import { InsightCard } from '@/components/insights/insight-card'
import { InsightsEmptyCta } from '@/components/insights/insights-empty-cta'
import {
  SEVERITY_META,
  SEVERITY_ORDER,
} from '@/components/insights/severity-meta'
import { AppLink } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useInsights } from '@/lib/query/use-insights'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

interface InsightsStripProps {
  hostId: number
  className?: string
}

/**
 * Compact one-row insights strip for the overview page.
 *
 * Renders every active insight in a single horizontally-scrollable row with the
 * scrollbar hidden (`scrollbar-hide`). When the row overflows, a chevron button
 * plus an edge fade appear on each scrollable side and page the row by ~one
 * viewport (`scrollBy`). A "View all insights" header link deep-links to the
 * full `/insights` board. Shares `useInsights` (and thus counts + dismissals)
 * with the board and header popover.
 */
export function InsightsStrip({ hostId, className }: InsightsStripProps) {
  const {
    insights,
    counts,
    isLoading,
    isGenerating,
    refresh,
    generate,
    dismiss,
  } = useInsights(hostId)

  const hasInsights = insights.length > 0

  // Empty + idle → slim CTA row, so the overview never shows an empty box.
  if (!hasInsights && !isLoading) {
    return (
      <InsightsEmptyCta
        hostId={hostId}
        isGenerating={isGenerating}
        onGenerate={generate}
        className={className}
      />
    )
  }

  return (
    <section
      className={cn('flex flex-col gap-2', className)}
      aria-label="AI insights"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">AI Insights</h2>
          {SEVERITY_ORDER.map((sev) =>
            counts[sev] > 0 ? (
              <Badge
                key={sev}
                variant="outline"
                className={cn(
                  'text-[10px] font-medium',
                  SEVERITY_META[sev].badge
                )}
              >
                {counts[sev]} {SEVERITY_META[sev].label.toLowerCase()}
              </Badge>
            ) : null
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            render={<AppLink href={buildUrl('/insights', { host: hostId })} />}
          >
            View all insights
            <ArrowRight className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              generate()
              refresh()
            }}
            disabled={isGenerating}
          >
            <RefreshCw
              className={cn('size-3.5', isGenerating && 'animate-spin')}
            />
            {isGenerating ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label="AI Insights settings"
            render={
              <AppLink
                href={buildUrl('/insights-settings', { host: hostId })}
              />
            }
          >
            <Settings2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {isLoading && !hasInsights ? (
        <div className="flex gap-3 overflow-hidden py-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-[132px] w-[19rem] shrink-0 rounded-xl"
            />
          ))}
        </div>
      ) : (
        <InsightsScroller measureKey={insights.length}>
          {insights.map((insight) => (
            <div key={insight.key} className="w-[19rem] shrink-0">
              <InsightCard
                insight={insight}
                hostId={hostId}
                onDismiss={dismiss}
              />
            </div>
          ))}
        </InsightsScroller>
      )}
    </section>
  )
}

/**
 * A single-row horizontal scroller with a hidden scrollbar and, only when the
 * content overflows, a chevron button + edge fade on each scrollable side.
 * `key`-ing the recompute on the children count means adding/removing cards
 * re-evaluates overflow (a ResizeObserver alone misses content-width changes).
 */
function InsightsScroller({
  children,
  measureKey,
}: {
  children: React.ReactNode
  /** Bumps when the rendered card count changes, forcing an overflow re-measure. */
  measureKey: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setCanLeft(el.scrollLeft > 1)
    setCanRight(el.scrollLeft < max - 1)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [update])

  // Content changes (insights loaded / dismissed) change scrollWidth without a
  // container resize, so re-measure whenever the rendered card count changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measureKey is the re-measure trigger
  useEffect(update, [update, measureKey])

  const page = (dir: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <div className="relative">
      {canLeft ? (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background to-transparent"
            aria-hidden
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute left-1 top-1/2 z-20 size-7 -translate-y-1/2 rounded-full bg-background/90 shadow-sm backdrop-blur"
            aria-label="Scroll insights left"
            onClick={() => page(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
        </>
      ) : null}

      <div
        ref={ref}
        className="scrollbar-hide flex gap-3 overflow-x-auto py-1.5"
      >
        {children}
      </div>

      {canRight ? (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background to-transparent"
            aria-hidden
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute right-1 top-1/2 z-20 size-7 -translate-y-1/2 rounded-full bg-background/90 shadow-sm backdrop-blur"
            aria-label="Scroll insights right"
            onClick={() => page(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </>
      ) : null}
    </div>
  )
}
