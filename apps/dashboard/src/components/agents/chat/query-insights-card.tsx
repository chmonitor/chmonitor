'use client'

import {
  ActivityIcon,
  ClockIcon,
  HardDriveIcon,
  MemoryStickIcon,
  TrendingUpIcon,
  ZapIcon,
} from 'lucide-react'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface InsightHighlight {
  readonly metric: string
  readonly value: string
  readonly detail: string
  readonly query?: string
  readonly user?: string
  readonly time?: string
}

interface QueryInsightsCardProps {
  readonly insights: {
    readonly highlights: readonly InsightHighlight[]
    readonly summary?: {
      readonly total_queries: number | string
      readonly total_scanned: string
      readonly total_rows_scanned: number | string
      readonly avg_duration_ms: number | string
    } | null
    readonly period: string
  }
}

const METRIC_ICONS: Record<string, typeof HardDriveIcon> = {
  'Largest Data Scan': HardDriveIcon,
  'Most Rows Scanned': ActivityIcon,
  'Fastest Scan Speed': ZapIcon,
  'Longest Query': ClockIcon,
  'Peak Memory': MemoryStickIcon,
}

const METRIC_COLORS: Record<string, string> = {
  'Largest Data Scan': 'text-[var(--chart-blue)]',
  'Most Rows Scanned': 'text-[var(--chart-1)]',
  'Fastest Scan Speed': 'text-[var(--chart-yellow)]',
  'Longest Query': 'text-[var(--chart-red)]',
  'Peak Memory': 'text-[var(--chart-3)]',
}

function InsightCard({ highlight }: { readonly highlight: InsightHighlight }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = METRIC_ICONS[highlight.metric] || TrendingUpIcon
  const color = METRIC_COLORS[highlight.metric] || 'text-muted-foreground'

  return (
    <Card
      className={cn(
        'cursor-pointer border-border/60 transition-[border-color] hover:border-border',
        expanded && 'col-span-full'
      )}
      onClick={() => setExpanded((prev) => !prev)}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className={cn('h-3.5 w-3.5', color)} />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {highlight.metric}
          </span>
        </div>
        <div className="text-lg font-bold tracking-tight">
          {highlight.value}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {highlight.detail}
        </div>
        {expanded && highlight.query && (
          <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
            <div className="flex gap-3 text-xs text-muted-foreground">
              {highlight.user && (
                <span>
                  User:{' '}
                  <strong className="text-foreground">{highlight.user}</strong>
                </span>
              )}
              {highlight.time && (
                <span>
                  Time:{' '}
                  <strong className="text-foreground">{highlight.time}</strong>
                </span>
              )}
            </div>
            <pre className="overflow-auto rounded bg-muted/50 p-2 text-xs font-mono">
              {highlight.query}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function QueryInsightsCard({ insights }: QueryInsightsCardProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUpIcon className="size-4 text-primary" />
          <span className="text-sm font-semibold">Query Insights</span>
        </div>
        <Badge variant="outline" className="text-[10px]">
          Last {insights.period}
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {insights.highlights.map((h) => (
          <InsightCard key={h.metric} highlight={h} />
        ))}
      </div>
      {insights.summary && (
        <div className="flex flex-wrap gap-3 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Total queries:{' '}
            <strong className="text-foreground">
              {String(insights.summary.total_queries)}
            </strong>
          </span>
          <span>
            Total scanned:{' '}
            <strong className="text-foreground">
              {insights.summary.total_scanned}
            </strong>
          </span>
          <span>
            Total rows:{' '}
            <strong className="text-foreground">
              {String(insights.summary.total_rows_scanned)}
            </strong>
          </span>
          <span>
            Avg duration:{' '}
            <strong className="text-foreground">
              {String(Math.round(Number(insights.summary.avg_duration_ms)))}ms
            </strong>
          </span>
        </div>
      )}
    </div>
  )
}
