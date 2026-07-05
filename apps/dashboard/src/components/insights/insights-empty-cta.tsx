import { Activity, RefreshCw, Settings2 } from 'lucide-react'

import { AppLink } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

interface InsightsEmptyCtaProps {
  hostId: number
  isGenerating: boolean
  onGenerate: () => void
  className?: string
}

/**
 * Slim, dashed-border call-to-action shown when a host has no active insights.
 * Shared by the overview strip and the insights-page board so the empty state
 * looks identical on both surfaces (never an empty box).
 */
export function InsightsEmptyCta({
  hostId,
  isGenerating,
  onGenerate,
  className,
}: InsightsEmptyCtaProps) {
  return (
    <section
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3',
        className
      )}
      aria-label="AI insights"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Activity className="size-4 shrink-0" />
        <span>
          No AI Insights yet. Generate a fresh AI analysis of this cluster.
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onGenerate}
          disabled={isGenerating}
        >
          <RefreshCw
            className={cn('size-3.5', isGenerating && 'animate-spin')}
          />
          {isGenerating ? 'Generating…' : 'Generate insights'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label="AI Insights settings"
          render={
            <AppLink href={buildUrl('/insights-settings', { host: hostId })} />
          }
        >
          <Settings2 className="size-3.5" />
        </Button>
      </div>
    </section>
  )
}
