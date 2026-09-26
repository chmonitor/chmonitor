/**
 * PeerDB AI Insights panel.
 *
 * A compact, self-contained strip surfaced at the top of `/peerdb`. It reads
 * AI insights for the env-wide PeerDB deployment via `usePeerDBInsights` and
 * reuses the shared `InsightCard`, so styling matches the ClickHouse insights
 * board and the Postgres panel.
 *
 * Renders nothing until there is at least one insight (or a generation is in
 * flight) and nothing at all when PeerDB is unconfigured — an empty box is not
 * a place to put "there is nothing to see", the page's own not-configured state
 * already says that. Kept intentionally minimal (no filter tabs / settings):
 * the full grouped board lives on `/insights` for ClickHouse.
 */

import { RefreshCw, Sparkles, X } from 'lucide-react'

import { InsightCard } from '@/components/insights/insight-card'
import {
  SEVERITY_META,
  SEVERITY_ORDER,
} from '@/components/insights/severity-meta'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { usePeerDBInsights } from '@/lib/query/use-peerdb-insights'
import { cn } from '@/lib/utils'

export function PeerDBInsightsPanel({ className }: { className?: string }) {
  const {
    insights,
    counts,
    isGenerating,
    isUnavailable,
    generate,
    refresh,
    dismiss,
    dismissAll,
  } = usePeerDBInsights()

  const hasInsights = insights.length > 0
  // Nothing to show, nothing pending, and no PeerDB here → render nothing.
  if (!hasInsights && !isGenerating) return null

  return (
    <section
      className={cn('flex flex-col gap-3', className)}
      aria-label="PeerDB AI insights"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">
            PeerDB Insights
          </h2>
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
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              generate()
              refresh()
            }}
            disabled={isGenerating || isUnavailable}
          >
            <RefreshCw
              className={cn('size-3.5', isGenerating && 'animate-spin')}
            />
            {isGenerating ? 'Refreshing…' : 'Refresh'}
          </Button>
          {hasInsights ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={dismissAll}
            >
              <X className="size-3.5" />
              Dismiss all
            </Button>
          ) : null}
        </div>
      </div>

      {hasInsights ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {insights.map((insight) => (
            <InsightCard
              key={insight.key}
              insight={insight}
              onDismiss={dismiss}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
