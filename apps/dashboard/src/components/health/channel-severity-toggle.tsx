import { cn } from '@/lib/utils'

/**
 * Per-channel severity override: Inherit / Warning+ / Critical. `Inherit`
 * clears the channel's `minSeverity` so it follows the global gate.
 */
export function ChannelSeverityToggle({
  value,
  onChange,
}: {
  value: 'warning' | 'critical' | undefined
  onChange: (next: 'warning' | 'critical' | undefined) => void
}) {
  const options: {
    label: string
    val: 'warning' | 'critical' | undefined
  }[] = [
    { label: 'Inherit', val: undefined },
    { label: 'Warning+', val: 'warning' },
    { label: 'Critical', val: 'critical' },
  ]
  return (
    <div className="flex items-center gap-1 text-xs">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          className={cn(
            'rounded-md px-2 py-1',
            value === o.val ? 'bg-secondary' : 'text-muted-foreground'
          )}
          onClick={() => onChange(o.val)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
