import type { LucideIcon } from 'lucide-react'
import { CheckCircle2, CircleX, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface HealthCounts {
  critical: number
  warning: number
  ok: number
}

interface BannerTheme {
  icon: LucideIcon
  title: string
  sub: string
  /** Card surface tint + border. Kept faint — the banner sets a tone, not a flag. */
  container: string
  icon_: string
  title_: string
}

function resolveTheme({ critical, warning, ok }: HealthCounts): BannerTheme {
  if (critical > 0) {
    return {
      icon: CircleX,
      title: 'Action required',
      sub: `${critical} critical issue${critical > 1 ? 's' : ''}${warning > 0 ? ` and ${warning} warning${warning > 1 ? 's' : ''}` : ''} need attention`,
      container: 'border-red-500/20 bg-red-500/[0.035]',
      icon_: 'text-red-600 dark:text-red-500',
      title_: 'text-red-600 dark:text-red-500',
    }
  }
  if (warning > 0) {
    return {
      icon: TriangleAlert,
      title: 'Minor issues',
      sub: `${warning} warning${warning > 1 ? 's' : ''} worth a look — nothing critical`,
      container: 'border-amber-500/20 bg-amber-500/[0.035]',
      icon_: 'text-amber-600 dark:text-amber-500',
      title_: 'text-amber-600 dark:text-amber-500',
    }
  }
  return {
    icon: CheckCircle2,
    title: 'All systems healthy',
    sub:
      ok > 0
        ? `No issues across ${ok} health check${ok > 1 ? 's' : ''}`
        : 'Waiting for health checks to report',
    // Healthy is the quietest state: a plain card surface, no tint.
    container: 'border-border bg-card',
    icon_: 'text-emerald-600 dark:text-emerald-500',
    title_: 'text-foreground',
  }
}

/**
 * Aggregate health banner: a restrained, severity-toned summary line (action
 * required / minor issues / all healthy). A subtle tint plus the colored icon +
 * title carry the severity — no accent rail, no saturated fill, no count pills
 * (the filter tabs below already carry the critical / warning / healthy tallies).
 */
export function HealthSummaryBanner({ counts }: { counts: HealthCounts }) {
  const theme = resolveTheme(counts)
  const Icon = theme.icon

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border py-3.5 pl-4 pr-4',
        theme.container
      )}
      role="status"
    >
      <Icon className={cn('size-5 flex-none', theme.icon_)} aria-hidden />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={cn('text-sm font-semibold', theme.title_)}>
          {theme.title}
        </span>
        <span className="text-[13px] text-muted-foreground">{theme.sub}</span>
      </div>
    </div>
  )
}
