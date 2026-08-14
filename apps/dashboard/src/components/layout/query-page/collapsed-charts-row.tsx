/**
 * CollapsedChartsRow
 *
 * A lightweight compact strip shown when a page's charts section is collapsed.
 * Renders static chart labels only — no data fetching, no polling — to satisfy
 * the invariant that collapsing stops all background chart work.
 *
 * Clicking the row calls `onExpand` to restore the full charts.
 */

import { ChevronDownIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface CollapsedChartsRowProps {
  /** Human-readable names for each chart in the section. */
  labels: string[]
  onExpand: () => void
  className?: string
}

export function CollapsedChartsRow({
  labels,
  onExpand,
  className,
}: CollapsedChartsRowProps) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className={cn(
        'group flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 transition-colors hover:bg-muted/50',
        className
      )}
      aria-label="Expand charts"
    >
      {/* Chart label pills */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {labels.map((label) => (
          <span
            key={label}
            className="shrink-0 truncate rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {label}
          </span>
        ))}
      </div>

      {/* "Expand" affordance — visible on hover / keyboard focus */}
      <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
        Expand
        <ChevronDownIcon className="size-3" />
      </span>
    </button>
  )
}
