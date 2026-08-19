import type { SettingsDiffView } from '@/lib/settings-diff/types'

import { SegmentedControl } from '@/components/filters/segmented-control'

interface SettingsViewToggleProps {
  value: SettingsDiffView
  onChange: (view: SettingsDiffView) => void
  hostCount: number
}

export function SettingsViewToggle({
  value,
  onChange,
  hostCount,
}: SettingsViewToggleProps) {
  if (hostCount < 2) return null

  return (
    <div aria-label="All hosts matrix or pair">
      <SegmentedControl
        value={value}
        onChange={(next) => {
          if (next === 'matrix' || next === 'pair') onChange(next)
        }}
        options={[
          { label: 'All hosts', value: 'matrix' },
          { label: 'Pair', value: 'pair' },
        ]}
      />
    </div>
  )
}
