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
 * Phone (below `sm`): the group takes its own full-width second header row
 * (`order-last basis-full`) with `flex-1`, 36px-tall chips, so the title row
 * keeps the 44×44 utilities (refresh, search, theme) right-aligned.
 * From `sm` the group shrinks to intrinsic width (same compact chips as
 * before) because the header is a single nowrap row with more room.
 */
export const GlobalTimeRangePicker = function GlobalTimeRangePicker() {
  const { timeRange, setTimeRange } = useTimeRange()

  return (
    <div
      className="order-last flex min-w-0 basis-full items-center gap-0.5 rounded-md border border-border/50 bg-muted/40 p-0.5 sm:order-none sm:flex-none sm:shrink-0 sm:basis-auto"
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
              'inline-flex min-h-9 min-w-0 flex-1 items-center justify-center rounded px-1.5 py-0.5 text-xs font-medium transition-colors sm:min-h-0 sm:flex-none sm:px-2',
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
