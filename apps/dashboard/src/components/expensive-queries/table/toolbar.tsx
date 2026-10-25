import { cn } from '@/lib/utils'

export const SEVERITY_FILTERS = ['all', 'critical', 'warning'] as const
export type SeverityFilter = (typeof SEVERITY_FILTERS)[number]

const SEVERITY_LABEL: Record<SeverityFilter, string> = {
  all: 'All',
  critical: 'Critical',
  warning: 'Warning+',
}

export function SeverityFilterBar({
  value,
  onChange,
}: {
  value: SeverityFilter
  onChange: (value: SeverityFilter) => void
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      {SEVERITY_FILTERS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            'h-7 whitespace-nowrap rounded px-2.5 text-[11.5px] max-sm:text-xs font-medium transition-colors',
            value === s
              ? 'bg-card text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {SEVERITY_LABEL[s]}
        </button>
      ))}
    </div>
  )
}
