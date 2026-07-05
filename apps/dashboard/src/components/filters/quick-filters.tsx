import type { FilterDraft } from '@/components/filters/filter-editor'
import type { ActiveFilter, QuickFilterConfig } from '@/lib/filters/types'

import { SegmentedControl } from '@/components/filters/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface QuickFiltersProps {
  /** Quick filter configs from schema */
  configs: QuickFilterConfig[]
  /** Currently active filters */
  activeFilters: ActiveFilter[]
  /** Callback to set a filter value */
  onSetFilter: (key: string, draft: FilterDraft) => void
  /** Optional className for the container */
  className?: string
}

/**
 * Renders quick filter controls based on their display type.
 * - segmented: Row of pill buttons for selecting from options
 * - select: Dropdown for selecting from options
 */
export function QuickFilters({
  configs,
  activeFilters,
  onSetFilter,
  className,
}: QuickFiltersProps) {
  if (configs.length === 0) return null

  // Map active filters by key for quick lookup
  const activeByKey = new Map(activeFilters.map((f) => [f.key, f]))

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {configs.map((config) => {
        const active = activeByKey.get(config.key)
        const currentValue = active?.values[0] ?? ''

        const handleValueChange = (value: string) => {
          if (value === '') {
            // Clear the filter (for "All" option)
            onSetFilter(config.key, {
              operator: 'eq',
              values: [],
            })
          } else {
            onSetFilter(config.key, {
              operator: 'eq',
              values: [value],
            })
          }
        }

        const label = config.label ?? config.key
        const Icon = config.icon

        switch (config.display) {
          case 'segmented': {
            const options = config.options ?? []
            const segmentedOptions = config.includeAll
              ? [{ label: 'All', value: '' }, ...options]
              : options

            return (
              <div key={config.key} className="flex items-center gap-2">
                {Icon && <Icon className="size-3.5 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">{label}:</span>
                <SegmentedControl
                  options={segmentedOptions}
                  value={currentValue}
                  onChange={handleValueChange}
                />
              </div>
            )
          }

          case 'select': {
            const options = config.options ?? []
            return (
              <div key={config.key} className="flex items-center gap-2">
                {Icon && <Icon className="size-3.5 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground">{label}:</span>
                <Select
                  value={currentValue}
                  onValueChange={(value) => {
                    if (value != null) handleValueChange(value)
                  }}
                >
                  <SelectTrigger className="h-7 w-[140px] text-xs">
                    <SelectValue placeholder={label} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="" className="text-xs">
                      All
                    </SelectItem>
                    {options.map((opt) => (
                      <SelectItem
                        key={opt.value}
                        value={opt.value}
                        className="text-xs"
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )
          }

          default:
            return null
        }
      })}
    </div>
  )
}
