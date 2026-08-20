// PeerDB-specific KPI card with integrated sparkline and status dot.
// Differs from overview-charts/kpi-card.tsx (main dashboard). Do not merge without design sign-off.

import type { ReactNode } from 'react'

import { PdbSparkline } from './pdb-charts'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: ReactNode
  sub?: string
  accent?: string
  dotColor?: string
  pulse?: boolean
  sparkData?: number[]
  sparkColor?: string
  /** Totals still aggregating — keep the card visually "in progress". */
  counting?: boolean
}

/** KPI stat card with a status dot and optional inline sparkline (PdbKpi). */
export function KpiCard({
  label,
  value,
  sub,
  accent,
  dotColor,
  pulse,
  sparkData,
  sparkColor,
  counting,
}: KpiCardProps) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-foreground/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {dotColor && (
            <span className="relative inline-flex">
              <span
                className="size-2 rounded-full"
                style={{ background: dotColor }}
              />
              {pulse && (
                <span
                  className="absolute inset-0 animate-ping rounded-full"
                  style={{ background: dotColor, opacity: 0.6 }}
                />
              )}
            </span>
          )}
          <span className="truncate text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </span>
        </div>
        {sparkData && sparkData.length > 1 && (
          <PdbSparkline
            data={sparkData}
            color={sparkColor || dotColor || '#10b981'}
            width={56}
            height={18}
            fill={0.22}
          />
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-[26px] font-bold leading-none tracking-tight tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </span>
        {sub && (
          <span
            className={cn(
              'ml-auto text-[11px] leading-tight text-muted-foreground',
              counting && 'motion-safe:animate-pulse motion-reduce:animate-none'
            )}
          >
            {sub}
          </span>
        )}
      </div>
    </div>
  )
}
