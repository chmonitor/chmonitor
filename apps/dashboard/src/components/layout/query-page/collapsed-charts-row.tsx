import { ChevronDownIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface CollapsedChartsRowProps {
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
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {labels.map((label) => (
          <span
            key={label}
            className="shrink-0 truncate rounded bg-muted px-2 py-0.5 text-[11px] max-sm:text-xs font-medium text-muted-foreground"
          >
            {label}
          </span>
        ))}
      </div>

      <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground opacity-40 pointer-fine:opacity-0 transition-opacity duration-200 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
        Expand
        <ChevronDownIcon className="size-3" />
      </span>
    </button>
  )
}
