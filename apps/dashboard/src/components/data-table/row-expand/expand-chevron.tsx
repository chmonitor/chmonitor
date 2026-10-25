import { ChevronRightIcon } from 'lucide-react'
import type { Row, RowData } from '@tanstack/react-table'

import { cn } from '@/lib/utils'

interface ExpandChevronProps<TData extends RowData> {
  row: Row<TData>
}

/**
 * Click target that toggles inline row expansion. Stops propagation so the
 * row's own click handler doesn't double-toggle.
 */
export function ExpandChevron<TData extends RowData>({
  row,
}: ExpandChevronProps<TData>) {
  if (!row.getCanExpand()) return null
  const expanded = row.getIsExpanded()
  return (
    <button
      type="button"
      aria-label={expanded ? 'Collapse row' : 'Expand row'}
      aria-expanded={expanded}
      data-no-expand
      onClick={(e) => {
        e.stopPropagation()
        row.toggleExpanded()
      }}
      className={cn(
        'relative inline-flex size-5 items-center pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-[""] justify-center rounded text-muted-foreground',
        'transition-all hover:bg-accent hover:text-foreground',
        expanded && 'text-foreground'
      )}
    >
      <ChevronRightIcon
        className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
      />
    </button>
  )
}
