/**
 * Compact AI-insights strip above the Postgres query-insights table. Renders nothing
 * until there is an insight or a generation in flight.
 */

import { RefreshCw, Sparkles, X } from 'lucide-react'

import { InsightCard } from '@/components/insights/insight-card'
import {
  SEVERITY_META,
  SEVERITY_ORDER,
} from '@/components/insights/severity-meta'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { PG_HOST_PARAM } from '@/lib/hooks/use-active-pg-connection'
import { usePostgresInsights } from '@/lib/query/use-postgres-insights'
import { cn } from '@/lib/utils'

interface PostgresInsightsPanelProps {
  pgHostId?: number
  className?: string
}

export function PostgresInsightsPanel({
  pgHostId = 0,
  className,
}: PostgresInsightsPanelProps) {
  const {
    insights,
    counts,
    isGenerating,
    generate,
    refresh,
    dismiss,
    dismissAll,
  } = usePostgresInsights(pgHostId)
  const searchParams = useUrlSearchParams()
  const activePg = searchParams.get(PG_HOST_PARAM)
  // Preserve the active ?pg= connection on card deep-links (the Postgres routing
  // dimension), falling back to the env source id when no connection is active.
  const linkSearch = { [PG_HOST_PARAM]: activePg ?? String(pgHostId) }

  const hasInsights = insights.length > 0
  if (!hasInsights && !isGenerating) return null

  return (
    <section
      className={cn('flex flex-col gap-3', className)}
      aria-label="Postgres AI insights"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">
            Postgres Insights
          </h2>
          {SEVERITY_ORDER.map((sev) =>
            counts[sev] > 0 ? (
              <Badge
                key={sev}
                variant="outline"
                className={cn(
                  'text-[10px] max-sm:text-xs font-medium',
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
            disabled={isGenerating}
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
              hostId={pgHostId}
              linkSearch={linkSearch}
              onDismiss={dismiss}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
