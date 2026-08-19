import type { CompareScope } from '@/lib/compare/scope'

import { SegmentedControl } from '@/components/filters/segmented-control'

interface CompareScopeToggleProps {
  value: CompareScope
  onChange: (scope: CompareScope) => void
  hostCount: number
  nodeCount: number
}

export function CompareScopeToggle({
  value,
  onChange,
  hostCount,
  nodeCount,
}: CompareScopeToggleProps) {
  if (hostCount < 2 || nodeCount < 2) return null

  return (
    <div aria-label="Compare saved hosts or cluster nodes">
      <SegmentedControl
        value={value}
        onChange={(next) => {
          if (next === 'hosts' || next === 'nodes') onChange(next)
        }}
        options={[
          { label: 'Saved hosts', value: 'hosts' },
          { label: 'Cluster nodes', value: 'nodes' },
        ]}
      />
    </div>
  )
}
