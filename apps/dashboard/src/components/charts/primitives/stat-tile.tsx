import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export const statValueClassName =
  'text-3xl font-bold tabular-nums leading-none text-foreground'

export interface StatTileProps {
  value: number | string
  label: string
  /** Applied to the value when numeric and greater than zero. */
  activeClassName?: string
  /** Stacked puts the label below the value; inline places it beside the value. */
  layout?: 'stacked' | 'inline'
  className?: string
  children?: ReactNode
}

export function StatTile({
  value,
  label,
  activeClassName = 'text-foreground',
  layout = 'stacked',
  className,
  children,
}: StatTileProps) {
  const numericValue = typeof value === 'number' ? value : Number(value)
  const isActive = Number.isFinite(numericValue) && numericValue > 0
  const valueClassName = cn(
    statValueClassName,
    isActive ? activeClassName : 'text-foreground'
  )

  if (layout === 'inline') {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 py-3',
          className
        )}
      >
        <div className="flex items-baseline gap-2">
          <span className={valueClassName}>{value}</span>
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col items-center gap-1 min-w-0', className)}>
      <span className={valueClassName}>{value}</span>
      <span className="text-xs text-muted-foreground tracking-wide uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}
