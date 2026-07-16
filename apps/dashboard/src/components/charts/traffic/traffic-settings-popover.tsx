import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  TRAFFIC_PRESETS,
  TRAFFIC_SECTION_IDS,
  TRAFFIC_SECTION_LABELS,
  type TrafficSectionVisibility,
  useTrafficSettings,
} from '@/lib/traffic/traffic-settings'
import { cn } from '@/lib/utils'

const VISIBILITY_OPTIONS: readonly {
  value: TrafficSectionVisibility
  label: string
}[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'show', label: 'Show' },
  { value: 'hide', label: 'Hide' },
]

/** Compact three-state pill toggle for one section row. */
function VisibilityToggle({
  value,
  onChange,
  ariaLabel,
}: {
  value: TrafficSectionVisibility
  onChange: (value: TrafficSectionVisibility) => void
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 items-center rounded-md border border-border p-0.5"
    >
      {VISIBILITY_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded px-2 py-0.5 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * View settings for /traffic: named presets plus a per-section visibility
 * override (Auto follows smart detection, Show/Hide are explicit). Persisted
 * in localStorage via useTrafficSettings.
 */
export function TrafficSettingsPopover() {
  const { settings, setSectionVisibility, applyPreset, activePresetId } =
    useTrafficSettings()

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontal className="mr-2 size-4" strokeWidth={1.5} />
        View
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Preset
            </span>
            <div className="flex flex-wrap gap-1.5">
              {TRAFFIC_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.description}
                  onClick={() => applyPreset(preset.id)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    activePresetId === preset.id
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Sections
            </span>
            <div className="flex flex-col gap-1.5">
              {TRAFFIC_SECTION_IDS.map((id) => (
                <div
                  key={id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate text-[13px]">
                    {TRAFFIC_SECTION_LABELS[id]}
                  </span>
                  <VisibilityToggle
                    ariaLabel={`${TRAFFIC_SECTION_LABELS[id]} visibility`}
                    value={settings.sections[id]}
                    onChange={(visibility) =>
                      setSectionVisibility(id, visibility)
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Auto hides a section when its data source is unavailable (e.g.
            part_log disabled, no replication, PeerDB not detected).
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
