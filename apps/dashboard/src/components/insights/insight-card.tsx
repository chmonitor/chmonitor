import { ArrowRight, X } from 'lucide-react'

import type { InsightCard as InsightCardData } from '@/lib/insights/types'

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
}

export function InsightCard({
  insight,
  hostId,
  onDismiss,
  className,
}: InsightCardProps) {
  const style = SEVERITY_META[insight.severity]
  const Icon = style.icon

  const generatedMs = insight.generatedAt
    ? new Date(insight.generatedAt).getTime()
    : Number.NaN
  const hasGeneratedAt = Number.isFinite(generatedMs)

  const action = insight.action
  const actionHref = action?.href
    ? buildUrl(action.href, { host: hostId })
    : action?.prompt
      ? buildUrl('/agents', { host: hostId })
      : undefined

  return (
    <Card
      className={cn(
        'h-full gap-0 border-l-2 p-4 transition-colors',
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
          onClick={() => onDismiss(insight)}
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
            asChild
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-0 text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            <Link href={actionHref}>
              {action.label}
              <ArrowRight className="size-3" />
            </Link>
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
