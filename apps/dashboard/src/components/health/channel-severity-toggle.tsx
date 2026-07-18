import { cn } from '@/lib/utils'

/**
 * Per-channel severity override control (#2661): a compact 3-way toggle —
 * Inherit (use the global gate) / Warning+ / Critical — mirroring the global
 * "Warning+ / Critical only" toggle's style. `Inherit` clears the channel's
 * `minSeverity` so it follows the global gate. Shared by the Health Settings
 * Alerts tab (localStorage channels) and the server-channel config panel (#2665).
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
