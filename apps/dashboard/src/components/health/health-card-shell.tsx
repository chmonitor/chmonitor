import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight } from 'lucide-react'

import type { HealthStatus } from '@/lib/health/health-status'
import type { RelatedLink } from './health-checks'

import { MiniAreaChart } from '@/components/charts/mini-charts'
import { AppLink } from '@/components/ui/app-link'
import { activateOnEnterOrSpace } from '@/lib/a11y'
import { cn } from '@/lib/utils'

/** Sparkline stroke color per severity (healthy → blue, matching KPI cards). */
const SPARK_COLOR: Record<HealthStatus, string> = {
  critical: 'hsl(0 84% 60%)',
  warning: 'hsl(38 92% 50%)',
  ok: 'hsl(217 91% 60%)',
  error: 'hsl(0 0% 60%)',
  loading: 'hsl(0 0% 60%)',
}

/** Headline value color — accented only when there is something to look at. */
const VALUE_COLOR: Record<HealthStatus, string> = {
  critical: 'text-red-600 dark:text-red-500',
  warning: 'text-amber-600 dark:text-amber-500',
  ok: 'text-foreground',
  error: 'text-muted-foreground',
  loading: 'text-foreground',
}

/** Tinted square behind the header icon — a restrained status cue. */
const ICON_WRAP: Record<HealthStatus, string> = {
  critical: 'bg-red-500/10 text-red-600 dark:text-red-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  error: 'bg-muted text-muted-foreground',
  loading: 'bg-muted text-muted-foreground',
}

/**
 * Status affordance: a labeled pill for issues (so severity reads at a glance),
 * a quiet dot otherwise. Restrained on purpose — the card stays neutral until
 * something actually needs attention.
 */
function StatusIndicator({ status }: { status: HealthStatus }) {
  if (status === 'critical' || status === 'warning') {
    return (
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide',
          status === 'critical'
            ? 'bg-red-500/12 text-red-600 dark:text-red-400'
            : 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
        )}
      >
        {status === 'critical' ? 'Critical' : 'Warning'}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full',
        status === 'ok' && 'bg-emerald-500',
        status === 'loading' && 'animate-pulse bg-muted-foreground/40',
        status === 'error' && 'bg-muted-foreground/40'
      )}
      role="img"
      aria-label={`Status: ${status}`}
    />
  )
}

/** Pad a single observation to a flat 2-point line so it still renders. */
function toSeries(spark: number[] | undefined): number[] | null {
  if (!spark || spark.length === 0) return null
  if (spark.length === 1) return [spark[0], spark[0]]
  return spark
}

export interface HealthCardShellProps {
  icon?: LucideIcon
  title: string
  status: HealthStatus
  /** Formatted headline value, e.g. "106" or "84.9%". */
  displayValue: string
  /** Secondary line under the value. */
  sublabel: string
  /** Observed values, oldest first, for the trend sparkline. */
  spark?: number[]
  /** Related internal pages, rendered as tappable chips. */
  links?: readonly RelatedLink[]
  /** Active host, used to append `?host=` to related links. */
  hostId: number
  /** When provided, the WHOLE card opens details (keyboard + pointer). */
  onExpand?: () => void
}

/**
 * Shared visual chrome for every health card: a neutral card surface with a
 * restrained status accent (a left rail + tinted icon only when there is an
 * issue), a clear typographic hierarchy (title · headline value · sub-label),
 * a trend sparkline, and a footer of related-page chips.
 *
 * The whole card is the click target when `onExpand` is provided — related-page
 * links stop propagation so they still navigate without opening the dialog.
 * Purely presentational: all status/value computation happens upstream.
 */
export function HealthCardShell({
  icon: Icon,
  title,
  status,
  displayValue,
  sublabel,
  spark,
  links,
  hostId,
  onExpand,
}: HealthCardShellProps) {
  const series = toSeries(spark)
  const withHost = (href: string) =>
    `${href}${href.includes('?') ? '&' : '?'}host=${hostId}`

  const isIssue = status === 'critical' || status === 'warning'

  // Only make the card interactive when it can actually open something —
  // avoids a role="button" with no handler. `onExpand` narrows to defined here.
  const interactiveProps = onExpand
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: onExpand,
        onKeyDown: activateOnEnterOrSpace(onExpand),
        'aria-label': `Open ${title} details`,
      }
    : {}

  return (
    <div
      {...interactiveProps}
      className={cn(
        'group relative flex min-h-[200px] flex-col overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-all',
        onExpand &&
          'cursor-pointer hover:border-foreground/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        status === 'critical' && 'border-red-500/25',
        status === 'warning' && 'border-amber-500/25'
      )}
    >
      {/* Restrained status accent: a thin left rail, issues only. */}
      {isIssue && (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 w-[3px]',
            status === 'critical' ? 'bg-red-500' : 'bg-amber-500'
          )}
        />
      )}

      {/* Header: tinted icon + title · status affordance */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span
              className={cn(
                'grid size-8 flex-none place-items-center rounded-lg',
                ICON_WRAP[status]
              )}
            >
              <Icon className="size-4" strokeWidth={1.5} aria-hidden />
            </span>
          )}
          <span className="truncate text-[13px] font-semibold leading-tight">
            {title}
          </span>
        </div>
        <div className="flex flex-none items-center pt-0.5">
          <StatusIndicator status={status} />
        </div>
      </div>

      {/* Body: headline value + sub-label */}
      <div className="mt-4">
        <div
          className={cn(
            'font-mono text-[32px] font-semibold leading-none tracking-tight tabular-nums',
            VALUE_COLOR[status]
          )}
        >
          {displayValue}
        </div>
        <div className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
          {sublabel}
        </div>
      </div>

      {/* Trend sparkline (real observed values, fills in over time) */}
      <div className="mt-3 h-[30px]">
        {series && (
          <MiniAreaChart
            data={series}
            label={title}
            color={SPARK_COLOR[status]}
          />
        )}
      </div>

      {/* Footer: related-page chips + a hover hint that the card opens details */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3.5">
        {links?.slice(0, 3).map((l) => (
          <AppLink
            key={l.href}
            href={withHost(l.href)}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'inline-flex items-center rounded-md px-2 py-0.5',
              'text-[11px] font-medium leading-none whitespace-nowrap',
              'bg-muted/60 text-muted-foreground',
              'transition-colors hover:bg-muted hover:text-foreground'
            )}
          >
            {l.label}
          </AppLink>
        ))}
        {onExpand && (
          <span
            aria-hidden
            className="ml-auto inline-flex flex-none items-center gap-0.5 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            Details
            <ArrowUpRight className="size-3" />
          </span>
        )}
      </div>
    </div>
  )
}
