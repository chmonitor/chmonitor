/**
 * Postgres AI Insights panel.
 *
 * A compact, self-contained strip surfaced above the Postgres query-insights
 * table. It reads AI insights for an env-configured Postgres source
 * (`pgHostId`) via `usePostgresInsights` and reuses the shared `InsightCard`
 * for styling consistency with the ClickHouse insights board. Deep-links carry
 * the active `?pg=` connection so navigation stays on the Postgres routing
 * dimension.
 *
 * Renders nothing until there is at least one insight (or a generation is in
 * flight), so a source with no findings — or a disabled feature flag — adds no
 * visual noise. Kept intentionally minimal (no filter tabs / settings): the full
 * grouped board lives on `/insights` for ClickHouse.
 */

import { RefreshCw, Sparkles, X } from 'lucide-react'

import { InsightCard } from '@/components/insights/insight-card'
import {
  SEVERITY_META,
  SEVERITY_ORDER,
} from '@/components/insights/severity-meta'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PG_HOST_PARAM } from '@/lib/hooks/use-active-pg-connection'
import { useSearchParams } from '@/lib/next-compat'
import { usePostgresInsights } from '@/lib/query/use-postgres-insights'
import { cn } from '@/lib/utils'

interface PostgresInsightsPanelProps {
  /**
   * Env Postgres source id (index into the POSTGRES_* lists) the insights are
   * generated for. Defaults to the primary source (0).
   */
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
  const searchParams = useSearchParams()
  const activePg = searchParams.get(PG_HOST_PARAM)
  // Preserve the active ?pg= connection on card deep-links (the Postgres routing
  // dimension), falling back to the env source id when no connection is active.
  const linkSearch = { [PG_HOST_PARAM]: activePg ?? String(pgHostId) }

  const hasInsights = insights.length > 0
  // Nothing to show and nothing pending → render nothing (no empty box).
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
