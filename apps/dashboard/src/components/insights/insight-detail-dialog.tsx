/**
 * Insight detail dialog.
 *
 * Opened by clicking a finding — either a row in the header `InsightsPopover` or
 * an `InsightCard` on the overview strip / insights board. Shows the full,
 * untruncated finding (title + severity + description + timestamp + category /
 * metric), the finding's existing deep-link action, an optional dismiss action
 * (reusing the same per-user dismissal mutation as the card/popover), and — when
 * the finding maps to one — the explanatory chart(s) that visualize it
 * (`lib/insights/insight-charts`, rendered via the chart registry). Findings
 * with no mapped chart simply omit the charts section.
 */

import { ArrowRight, X } from 'lucide-react'

import type { InsightCard as InsightCardData } from '@/lib/insights/types'

import { Suspense } from 'react'
import { getChartComponent } from '@/components/charts/chart-registry'
import { SEVERITY_META } from '@/components/insights/severity-meta'
import { DynamicChart } from '@/components/layout/query-page/dynamic-chart'
import { ChartSkeleton } from '@/components/skeletons/chart'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { insightChartNames } from '@/lib/insights/insight-charts'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/utils/format-relative-time'

interface InsightDetailDialogProps {
  insight: InsightCardData
  hostId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Reuse the caller's per-user dismissal. When omitted, no dismiss button. */
  onDismiss?: (insight: InsightCardData) => void
  /**
   * Search params for the action deep-link, overriding the default
   * `{ host: hostId }` (Postgres insights pass their `?pg=` source). Mirrors
   * `InsightCard`'s `linkSearch`.
   */
  linkSearch?: Record<string, string | number>
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function InsightDetailDialog({
  insight,
  hostId,
  open,
  onOpenChange,
  onDismiss,
  linkSearch,
}: InsightDetailDialogProps) {
  const style = SEVERITY_META[insight.severity]
  const Icon = style.icon

  const generatedMs = insight.generatedAt
    ? new Date(insight.generatedAt).getTime()
    : Number.NaN
  const hasGeneratedAt = Number.isFinite(generatedMs)

  const linkParams = linkSearch ?? { host: hostId }
  const action = insight.action
  const actionHref = action?.href
    ? buildUrl(action.href, linkParams)
    : action?.prompt
      ? buildUrl('/agents', linkParams)
      : undefined

  // Only render charts that actually exist in the registry, so an unknown key
  // never produces a broken chart.
  const chartNames = insightChartNames(insight).filter((name) =>
    Boolean(getChartComponent(name))
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
                style.iconBg
              )}
            >
              <Icon className={cn('size-4', style.iconColor)} />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base leading-snug">
                {insight.title}
              </DialogTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn('text-[10px] font-medium', style.badge)}
                >
                  {style.label}
                </Badge>
                <Badge variant="secondary" className="text-[10px] font-medium">
                  {titleCase(insight.category)}
                </Badge>
                {insight.metric ? (
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] text-muted-foreground"
                  >
                    {insight.metric}
                  </Badge>
                ) : null}
                {hasGeneratedAt ? (
                  <time
                    dateTime={insight.generatedAt}
                    title={new Date(generatedMs).toLocaleString()}
                    className="text-[11px] text-muted-foreground/80"
                  >
                    {formatRelativeTime(generatedMs)}
                  </time>
                ) : null}
              </div>
            </div>
          </div>
        </DialogHeader>

        <DialogDescription className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {insight.detail}
        </DialogDescription>

        {chartNames.length > 0 ? (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {chartNames.length > 1 ? 'Related charts' : 'Related chart'}
              </p>
              <div
                className={cn(
                  'grid gap-3',
                  chartNames.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'
                )}
              >
                {chartNames.map((name) => (
                  <div key={name} className="rounded-lg border bg-card p-3">
                    <Suspense fallback={<ChartSkeleton />}>
                      <DynamicChart chartName={name} />
                    </Suspense>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          {onDismiss ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                onDismiss(insight)
                onOpenChange(false)
              }}
            >
              <X className="size-3.5" />
              Dismiss
            </Button>
          ) : (
            <span />
          )}
          {action && actionHref ? (
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              render={
                <Link href={actionHref} onClick={() => onOpenChange(false)} />
              }
            >
              {action.label}
              <ArrowRight className="size-3.5" />
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
