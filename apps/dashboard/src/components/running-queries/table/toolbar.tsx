import { cn } from '@/lib/utils'

/** Segmented query-kind filter ("All / SELECT / INSERT / …"). */
export function KindFilter({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string
  onChange: (kind: string) => void
}) {
  return (
    <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-muted p-0.5">
      {options.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => onChange(kind)}
          className={cn(
            'h-7 whitespace-nowrap rounded px-2.5 text-[11.5px] font-medium uppercase tracking-wide transition-colors',
            value === kind
              ? 'bg-card text-foreground'
              : 'text-foreground/70 hover:text-foreground'
          )}
        >
          {kind === 'all' ? 'All' : kind}
        </button>
      ))}
    </div>
  )
}
