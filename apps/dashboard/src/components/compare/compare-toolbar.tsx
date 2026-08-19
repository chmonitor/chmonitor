import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface CompareToolbarProps {
  tabs?: ReactNode
  children: ReactNode
  className?: string
}

/** Shared compare-tools chrome: padded card, tabs on top, fields below. */
export function CompareToolbar({
  tabs,
  children,
  className,
}: CompareToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm',
        className
      )}
    >
      {tabs ? (
        <div className="flex flex-wrap items-center gap-2">{tabs}</div>
      ) : null}
      {children}
    </div>
  )
}
