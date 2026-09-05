'use client'

import type { ReactNode } from 'react'

/**
 * Small uppercase caption to the left of a compact row's control, e.g. "Host"
 * next to the host chip. Keeps every row in the Connection block scannable
 * without a full per-control header.
 */
export function LabeledRow({
  tag,
  children,
}: {
  tag: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-11 shrink-0 text-[9.5px] font-semibold tracking-wider uppercase">
        {tag}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
