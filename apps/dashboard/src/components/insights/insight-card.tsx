import { ArrowRight, X } from 'lucide-react'

import type { InsightCard as InsightCardData } from '@/lib/insights/types'

import { useState } from 'react'
import { InsightDetailDialog } from '@/components/insights/insight-detail-dialog'
import { SEVERITY_META } from '@/components/insights/severity-meta'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/utils/format-relative-time'

interface InsightCardProps {
  insight: InsightCardData
  hostId: number
  onDismiss: (insight: InsightCardData) => void
  className?: string
  /**
   * Search params to attach to the card's action deep-link, overriding the
   * default `{ host: hostId }`. Postgres insights pass the active `?pg=` source
   * so the link stays on the Postgres routing dimension instead of `?host`.
   */
  linkSearch?: Record<string, string | number>
}

export function InsightCard({
  insight,
  hostId,
  onDismiss,
  className,
  linkSearch,
}: InsightCardProps) {
  const [detailOpen, setDetailOpen] = useState(false)
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

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`View insight: ${insight.title}`}
      onClick={() => setDetailOpen(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setDetailOpen(true)
        }
      }}
      className={cn(
        'h-full cursor-pointer gap-0 border-l-0 p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        style.accent,
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md',
            style.iconBg
          )}
        >
          <Icon className={cn('size-3.5', style.iconColor)} />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1.5 -mt-1.5 size-7 shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
          aria-label={`Dismiss insight: ${insight.title}`}
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(insight)
          }}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      <h3 className="mt-3 text-sm font-medium leading-snug text-foreground">
        {insight.title}
      </h3>
      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {insight.detail}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="outline"
            className={cn('text-[10px] font-medium', style.badge)}
          >
            {style.label}
          </Badge>
          {hasGeneratedAt ? (
            <time
              dateTime={insight.generatedAt}
              title={new Date(generatedMs).toLocaleString()}
              className="truncate text-[10px] text-muted-foreground/70"
            >
              {formatRelativeTime(generatedMs)}
            </time>
          ) : null}
        </div>
        {action && actionHref ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-0 text-xs font-normal text-muted-foreground hover:text-foreground"
            render={
              <Link href={actionHref} onClick={(e) => e.stopPropagation()} />
            }
          >
            {action.label}
            <ArrowRight className="size-3" />
          </Button>
        ) : null}
      </div>

      <InsightDetailDialog
        insight={insight}
        hostId={hostId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDismiss={onDismiss}
        linkSearch={linkSearch}
      />
    </Card>
  )
}
