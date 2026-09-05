import { Clock, Rows3 } from 'lucide-react'

import type { DefaultTimeRange, UserSettings } from '@/lib/types/user-settings'

import { Field } from '../field'
import { DensityPreview, densityOptions } from '../layout/density-preview'
import { SegmentedControl } from '../segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TabsContent } from '@/components/ui/tabs'
import { TIME_RANGE_PRESETS } from '@/lib/context/time-range-context'

export function LayoutTab({
  settings,
  onUpdate,
}: {
  settings: UserSettings
  onUpdate: (updates: Partial<UserSettings>) => void
}) {
  return (
    <TabsContent value="layout" className="space-y-5 px-1 pb-2">
      <Field
        label="Table density"
        icon={Rows3}
        description="Row height for data tables. Compact fits more rows on screen."
      >
        <SegmentedControl
          ariaLabel="Table density"
          value={settings.tableDensity}
          onChange={(value) => onUpdate({ tableDensity: value })}
          options={densityOptions}
        />
        <DensityPreview density={settings.tableDensity} />
      </Field>

      <Field
        label="Default time range"
        icon={Clock}
        description="Initial time range for time-series pages. Explicit clicks and shared ?range= links still take priority."
      >
        <Select
          value={settings.defaultTimeRange}
          onValueChange={(value) =>
            value && onUpdate({ defaultTimeRange: value as DefaultTimeRange })
          }
        >
          <SelectTrigger id="default-time-range" className="h-9">
            <SelectValue placeholder="Select default range" />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGE_PRESETS.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </TabsContent>
  )
}
