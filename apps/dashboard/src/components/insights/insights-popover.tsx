/**
 * AI Insights header popover.
 *
 * A global, cross-page surface for AI insights (mirrors NotificationsPopover):
 * a Sparkles icon with a severity-count badge, and a popover listing the top
 * insights with deep links plus footer links to the full overview panel and the
 * settings page. Reuses the same `useInsights` hook + per-user dismissal as the
 * overview panel, so counts and dismissals stay in sync everywhere.
 */

import {
  AlertTriangle,
  ArrowRight,
  Lightbulb,
  RefreshCw,
  Settings2,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'

import type { InsightCard, InsightSeverity } from '@/lib/insights/types'

import { useState } from 'react'
import { InsightDetailDialog } from '@/components/insights/insight-detail-dialog'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useInsights } from '@/lib/query/use-insights'
import { useHostId } from '@/lib/swr/use-host'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

const SEVERITY_ICON: Record<InsightSeverity, typeof AlertTriangle> = {
  critical: AlertTriangle,
  warning: TriangleAlert,
  info: Lightbulb,
}

const SEVERITY_COLOR: Record<InsightSeverity, string> = {
  critical: 'text-rose-600 dark:text-rose-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-sky-600 dark:text-sky-400',
}

const SEVERITY_BG: Record<InsightSeverity, string> = {
  critical: 'bg-rose-500/10',
  warning: 'bg-amber-500/10',
  info: 'bg-sky-500/10',
}

const VISIBLE = 5

export function InsightsPopover() {
  const [isOpen, setIsOpen] = useState(false)
  const hostId = useHostId()
  const {
    insights,
    counts,
    isLoading,
    error,
    refresh,
    generate,
    isGenerating,
    dismiss,
  } = useInsights(hostId)

  const total = counts.critical + counts.warning + counts.info
  const settingsHref = buildUrl('/insights-settings', { host: hostId })
  const overviewHref = buildUrl('/overview', { host: hostId })

  // Nothing to show and not loading → disabled icon (matches NotificationsPopover).
  if (!isLoading && !error && total === 0) {
    return (
      <IconButton
        tooltip="AI Insights"
        icon={<Sparkles className="size-4 text-muted-foreground" />}
        className="hidden sm:flex"
        disabled
      />
    )
  }

  if (isLoading) {
    return (
      <div className="relative hidden sm:flex">
        <IconButton
          tooltip="AI Insights"
          icon={<Sparkles className="size-4" />}
          className="hidden sm:flex"
        />
        <div className="absolute -top-1 -right-1 size-4 rounded-full bg-muted animate-pulse" />
      </div>
    )
  }

  if (error) {
    return (
      <IconButton
        tooltip="AI Insights (error loading)"
        icon={<Sparkles className="size-4 text-muted-foreground" />}
        className="hidden sm:flex"
        onClick={() => refresh()}
      />
    )
  }

  const badgeTone =
    counts.critical > 0
      ? 'bg-rose-500 text-white'
      : counts.warning > 0
        ? 'bg-amber-500 text-white'
        : 'bg-sky-500 text-white'

  const visible = insights.slice(0, VISIBLE)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger render={<div className="relative hidden sm:flex" />}>
        <IconButton
          tooltip={`${total} AI insight${total === 1 ? '' : 's'}`}
          icon={<Sparkles className="size-4" />}
          className="hidden sm:flex"
        />
        {total > 0 && (
          <Badge
            className={cn(
              'absolute -top-0.5 -right-0.5 size-3.5 flex items-center justify-center border-transparent p-0 text-[10px] font-medium tabular-nums',
              badgeTone
            )}
          >
            {total > 99 ? '99+' : total}
          </Badge>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-sky-500" />
            <h3 className="text-sm font-semibold">AI Insights</h3>
            {total > 0 && (
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[10px] tabular-nums"
              >
                {total}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="AI Insights settings"
              render={<Link href={settingsHref} />}
            >
              <Settings2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setIsOpen(false)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-6 text-center">
            <Sparkles className="mb-2 size-6 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">No insights</p>
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto py-1">
            {visible.map((insight) => (
              <InsightsPopoverItem
                key={insight.key}
                insight={insight}
                hostId={hostId}
                onDismiss={dismiss}
                onOpenDetail={() => setIsOpen(false)}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t bg-muted/30 px-2.5 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              generate()
              refresh()
            }}
            disabled={isGenerating}
          >
            <RefreshCw
              className={cn('size-3', isGenerating && 'animate-spin')}
            />
            {isGenerating ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            render={
              <Link href={overviewHref} onClick={() => setIsOpen(false)} />
            }
          >
            View all
            <ArrowRight className="size-3" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function InsightsPopoverItem({
  insight,
  hostId,
  onDismiss,
  onOpenDetail,
}: {
  insight: InsightCard
  hostId: number
  onDismiss: (insight: InsightCard) => void
  /** Called when the detail dialog opens, so the popover can close behind it. */
  onOpenDetail: () => void
}) {
  const [detailOpen, setDetailOpen] = useState(false)
  const Icon = SEVERITY_ICON[insight.severity]

  const open = () => {
    setDetailOpen(true)
    onOpenDetail()
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`View insight: ${insight.title}`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
        className="group relative block cursor-pointer rounded-md transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start gap-3 px-3 py-2.5">
          <div
            className={cn(
              'mt-0.5 shrink-0 rounded-md p-1.5',
              SEVERITY_BG[insight.severity]
            )}
          >
            <Icon className={cn('size-4', SEVERITY_COLOR[insight.severity])} />
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-sm font-medium">{insight.title}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {insight.detail}
            </p>
          </div>
        </div>
      </div>

      <InsightDetailDialog
        insight={insight}
        hostId={hostId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDismiss={onDismiss}
      />
    </>
  )
}
