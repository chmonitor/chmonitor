'use client'

import type { ReactNode } from 'react'

/** Header for a static (non-collapsible) block — Connection, Daily AI usage. */
export function StaticSectionHeader({
  label,
  right,
}: {
  label: string
  right?: ReactNode
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <div className="text-muted-foreground text-[10.5px] font-semibold tracking-wider uppercase">
        {label}
      </div>
      {right}
    </div>
  )
}
