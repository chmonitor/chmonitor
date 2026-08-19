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
    <SegmentedControl
      ariaLabel="Compare saved connections or replica nodes"
      value={value}
      onChange={(next) => {
        if (next === 'hosts' || next === 'nodes') onChange(next)
      }}
      options={[
        {
          label: 'Connections',
          value: 'hosts',
          tooltip: 'Saved ClickHouse connections',
        },
        {
          label: 'Replica nodes',
          value: 'nodes',
          tooltip: 'Nodes in this cluster',
        },
      ]}
    />
  )
}
