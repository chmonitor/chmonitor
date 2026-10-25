import { cn } from '@/lib/utils'

export function DetailField({
  label,
  value,
  mono = true,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="min-w-0 border-l border-t border-border px-3 py-2">
      <dt className="text-[10px] max-sm:text-xs font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-[12.5px] font-medium tabular-nums',
          mono && 'font-mono'
        )}
        title={typeof value === 'string' ? value : undefined}
      >
        {value || '—'}
      </dd>
    </div>
  )
}
