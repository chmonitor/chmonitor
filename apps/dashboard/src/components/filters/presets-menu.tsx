import { SparklesIcon } from 'lucide-react'

import type { FilterPreset } from '@/lib/filters/types'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface PresetsMenuProps {
  presets: FilterPreset[]
  onApply: (preset: FilterPreset) => void
}

/** Dropdown of one-click filter bundles. */
export function PresetsMenu({ presets, onApply }: PresetsMenuProps) {
  return (
    // `modal={false}` matches the sibling "Display options" dropdown. The
    // default modal behavior runs Radix `hideOthers()`, which stamps
    // `aria-hidden` onto every top-level container (sidebar, header, the whole
    // table) on open and strips them on close — forcing a full-page a11y/style
    // recompute that reads as a "full page re-render" each time Presets opens.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 px-3 rounded-lg"
          />
        }
      >
        <SparklesIcon className="size-3.5" />
        Presets
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {presets.map((preset) => {
          const PresetIcon = preset.icon
          return (
            <DropdownMenuItem
              key={preset.name}
              onClick={() => onApply(preset)}
              className="gap-2"
            >
              {PresetIcon && (
                <PresetIcon className="size-4 text-muted-foreground" />
              )}
              {preset.name}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
