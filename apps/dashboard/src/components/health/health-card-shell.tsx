import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight, ChevronRight } from 'lucide-react'

import type { HealthStatus } from '@/lib/health/health-status'
import type { RelatedLink } from './health-checks'

import { MiniAreaChart } from '@/components/charts/mini-charts'
import { AppLink } from '@/components/ui/app-link'
import { activateOnEnterOrSpace } from '@/lib/a11y'
import { cn } from '@/lib/utils'

/** How a health check presents itself. Issues expand; healthy checks recede. */
export type HealthCardVariant = 'card' | 'row'

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

/** A small severity dot — the quiet status cue used in the dense row layout. */
const STATUS_DOT: Record<HealthStatus, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  ok: 'bg-emerald-500',
  error: 'bg-muted-foreground/40',
  loading: 'animate-pulse bg-muted-foreground/40',
}

/**
 * Status affordance for the expanded card: a labeled pill so severity reads at
 * a glance. Cards are only rendered for issues, so this always has a label.
 */
function IssuePill({ status }: { status: HealthStatus }) {
  if (status !== 'critical' && status !== 'warning') return null
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
  /**
   * `card` (default) — the full expanded treatment for checks that need
   * attention. `row` — a dense, quiet single line for healthy / unavailable
   * checks, so they recede instead of competing with real problems.
   */
  variant?: HealthCardVariant
}

/**
 * Shared presentation for a health check. Two layouts, one contract:
 *
 * - `variant="card"` — the expanded treatment (icon glyph, headline value,
 *   trend sparkline, related-page chips). Reserved for issues, which the grid
 *   surfaces first so they dominate the page.
 * - `variant="row"` — a dense line (`dot · icon · title · value · chevron`) for
 *   healthy or unavailable checks, so a green cluster reads as one calm list
 *   rather than a wall of identical cards.
 *
 * The whole element is the click target when `onExpand` is provided — related
 * links stop propagation so they still navigate. Purely presentational: all
 * status / value computation happens upstream.
 */
export function HealthCardShell(props: HealthCardShellProps) {
  return props.variant === 'row' ? (
    <HealthCheckRow {...props} />
  ) : (
    <HealthCheckCard {...props} />
  )
}

/** Shared interactive-target props: the whole element opens the detail dialog. */
function interactiveProps(title: string, onExpand: (() => void) | undefined) {
  return onExpand
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: onExpand,
        onKeyDown: activateOnEnterOrSpace(onExpand),
        'aria-label': `Open ${title} details`,
      }
    : {}
}

/**
 * Dense single-line layout for healthy / unavailable checks. No sparkline — a
 * healthy check sits flat, so a trend line here would be pure decoration. Links
 * stay reachable via the detail dialog, keeping the row uncluttered.
 */
function HealthCheckRow({
  icon: Icon,
  title,
  status,
  displayValue,
  sublabel,
  onExpand,
}: HealthCardShellProps) {
  return (
    <div
      {...interactiveProps(title, onExpand)}
      className={cn(
        'group flex items-center gap-3 px-4 py-2.5 transition-colors',
        onExpand &&
          'cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
      )}
    >
      <span
        className={cn('size-1.5 flex-none rounded-full', STATUS_DOT[status])}
        role="img"
        aria-label={`Status: ${status}`}
      />
      {Icon && (
        <Icon
          className="size-4 flex-none text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
      )}
      <span className="flex-none truncate text-[13px] font-medium">
        {title}
      </span>
      <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
        {sublabel}
      </span>
      <span
        className={cn(
          'ml-auto flex-none font-mono text-sm font-semibold tabular-nums sm:ml-0',
          VALUE_COLOR[status]
        )}
      >
        {displayValue}
      </span>
      <ChevronRight
        className="size-4 flex-none text-muted-foreground/40 transition-colors group-hover:text-muted-foreground"
        aria-hidden
      />
    </div>
  )
}

/** Expanded card layout, reserved for checks that need attention. */
function HealthCheckCard({
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

  return (
    <div
      {...interactiveProps(title, onExpand)}
      className={cn(
        'group flex min-h-[188px] flex-col overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-all',
        onExpand &&
          'cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        status === 'critical'
          ? 'border-red-500/30 hover:border-red-500/50'
          : status === 'warning'
            ? 'border-amber-500/30 hover:border-amber-500/50'
            : 'hover:border-foreground/20'
      )}
    >
      {/* Header: plain icon glyph + title · severity pill */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <Icon
              className="size-4 flex-none text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden
            />
          )}
          <span className="truncate text-[13px] font-semibold leading-tight">
            {title}
          </span>
        </div>
        <div className="flex flex-none items-center pt-0.5">
          <IssuePill status={status} />
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
