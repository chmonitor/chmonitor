import { ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface SortableHeaderProps {
  children: React.ReactNode
  align?: 'left' | 'right'
  width?: string
  className?: string
  sortKey?: string
  activeKey?: string
  dir?: 'asc' | 'desc'
  onSort?: (key: string) => void
}

export function SortableHeader({
  children,
  align = 'left',
  width,
  className,
  sortKey,
  activeKey,
  dir,
  onSort,
}: SortableHeaderProps) {
  const active = sortKey != null && sortKey === activeKey
  return (
    <th
      className={cn(
        'select-none whitespace-nowrap px-2 py-2 text-[10.5px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:px-3',
        align === 'right' ? 'text-right' : 'text-left',
        className
      )}
      style={width ? { width } : undefined}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={cn(
            'inline-flex items-center gap-1 transition-colors hover:text-foreground',
            align === 'right' && 'flex-row-reverse'
          )}
        >
          {children}
          {active ? (
            dir === 'desc' ? (
              <ChevronDown className="size-3 text-foreground" />
            ) : (
              <ChevronUp className="size-3 text-foreground" />
            )
          ) : (
            <ChevronDown className="size-3 opacity-30" />
          )}
        </button>
      ) : (
        children
      )}
    </th>
  )
}
