import {
  TIME_RANGE_PRESETS,
  useTimeRange,
} from '@/lib/context/time-range-context'
import { cn } from '@/lib/utils'

/**
 * GlobalTimeRangePicker - Compact preset button group shown in the app header.
 *
 * Sets the global default lastHours used by all charts that do not have an
 * individual per-chart date range selector configured.
 *
 * Phone (below `sm`): chips stay compact and `flex-1` so 1h…30d fills the
 * remaining header row beside the 44×44 utilities. 44×44 chips (#3108)
 * overflowed 375 and clipped the theme icon / left an empty band.
 * From `sm` the group shrinks to intrinsic width (same compact chips as
 * before) because the header is a single nowrap row with more room.
 */
export const GlobalTimeRangePicker = function GlobalTimeRangePicker() {
  const { timeRange, setTimeRange } = useTimeRange()

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-0.5 rounded-md border border-border/50 bg-muted/40 p-0.5 sm:flex-none sm:shrink-0"
      role="group"
      aria-label="Global time range"
    >
      {TIME_RANGE_PRESETS.map((preset) => {
        const isActive = timeRange.value === preset.value
        return (
          <button
            key={preset.value}
            type="button"
            onClick={() => setTimeRange(preset)}
            aria-pressed={isActive}
            title={`Show last ${preset.label}`}
            className={cn(
              'inline-flex min-w-0 flex-1 items-center justify-center rounded px-1.5 py-0.5 text-xs font-medium transition-colors sm:flex-none sm:px-2',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {preset.label}
          </button>
        )
      })}
    </div>
  )
}
