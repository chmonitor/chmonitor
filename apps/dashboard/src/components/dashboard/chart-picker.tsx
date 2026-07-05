/**
 * ChartPicker
 *
 * Multi-select dropdown listing all available charts from the registry,
 * grouped by category. Users check/uncheck charts to add/remove them from
 * the current dashboard view.
 */

import { PlusCircledIcon } from '@radix-ui/react-icons'

import { useState } from 'react'
import { CHARTS_BY_CATEGORY } from '@/components/charts/registry'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// Category display labels
const CATEGORY_LABELS: Record<string, string> = {
  query: 'Query',
  merge: 'Merge',
  system: 'System',
  replication: 'Replication',
  zookeeper: 'ZooKeeper',
  connection: 'Connection',
  table: 'Table',
  'page-view': 'Page Views',
}

// Chart display labels derived from kebab-case name
function toLabel(name: string): string {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

interface ChartPickerProps {
  selectedCharts: string[]
  onChange: (charts: string[]) => void
}

export function ChartPicker({ selectedCharts, onChange }: ChartPickerProps) {
  const [open, setOpen] = useState(false)

  function toggle(chartName: string) {
    if (selectedCharts.includes(chartName)) {
      onChange(selectedCharts.filter((c) => c !== chartName))
    } else {
      onChange([...selectedCharts, chartName])
    }
  }

  const categories = Object.entries(CHARTS_BY_CATEGORY).filter(
    ([, charts]) => charts.length > 0
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <PlusCircledIcon className="mr-1 size-3" />
        Add Charts
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="max-h-[420px] overflow-y-auto p-2">
          {categories.map(([category, charts]) => (
            <div key={category} className="mb-3">
              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {CATEGORY_LABELS[category] ?? category}
              </div>
              {charts.map((chartName) => {
                const checked = selectedCharts.includes(chartName)
                return (
                  <button
                    key={chartName}
                    type="button"
                    onClick={() => toggle(chartName)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
                      checked
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted'
                      )}
                    >
                      {checked && (
                        <svg
                          viewBox="0 0 10 10"
                          className="size-2.5"
                          fill="currentColor"
                        >
                          <path
                            d="M1.5 5l2.5 2.5 4.5-4.5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    {toLabel(chartName)}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
