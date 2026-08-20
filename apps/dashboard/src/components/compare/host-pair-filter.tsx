import { ArrowRightIcon } from 'lucide-react'

import type { ReactNode } from 'react'
import type { ComparePeer } from '@/lib/compare/scope'

import { ComparePeerSelect } from './compare-peer-select'
import { SegmentedControl } from '@/components/filters/segmented-control'
import { Input } from '@/components/ui/input'

interface HostPairFilterProps {
  hosts: ComparePeer[]
  sourceHostId: number
  targetHostId: number
  nameFilter?: string
  nameFilterPlaceholder?: string
  showDiffsOnly: boolean
  diffsOnlyLabel?: string
  onPairChange: (source: number, target: number) => void
  onNameFilterChange?: (value: string) => void
  onShowDiffsOnlyChange: (value: boolean) => void
  extraFilters?: ReactNode
}

export function HostPairFilter({
  hosts,
  sourceHostId,
  targetHostId,
  nameFilter,
  nameFilterPlaceholder = 'Filter tables…',
  showDiffsOnly,
  onPairChange,
  onNameFilterChange,
  onShowDiffsOnlyChange,
  extraFilters,
}: HostPairFilterProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <ComparePeerSelect
          label="Source"
          testId="compare-source"
          value={sourceHostId}
          hosts={hosts}
          onChange={(next) => {
            const nextTarget =
              next === targetHostId ? sourceHostId : targetHostId
            onPairChange(next, nextTarget)
          }}
        />
        <ArrowRightIcon
          className="mb-3 hidden size-4 shrink-0 text-muted-foreground sm:block"
          strokeWidth={1.5}
          aria-hidden
        />
        <ComparePeerSelect
          label="Target"
          testId="compare-target"
          value={targetHostId}
          hosts={hosts}
          onChange={(next) => {
            const nextSource =
              next === sourceHostId ? targetHostId : sourceHostId
            onPairChange(nextSource, next)
          }}
        />
        {onNameFilterChange ? (
          <label className="flex min-w-48 flex-1 flex-col gap-1 sm:max-w-72">
            <span className="text-[11px] font-medium text-muted-foreground">
              Filter
            </span>
            <Input
              placeholder={nameFilterPlaceholder}
              value={nameFilter ?? ''}
              onChange={(e) => onNameFilterChange(e.target.value)}
              className="h-11"
            />
          </label>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          size="sm"
          ariaLabel="Show differences or all rows"
          value={showDiffsOnly ? 'diffs' : 'all'}
          onChange={(next) => onShowDiffsOnlyChange(next === 'diffs')}
          options={[
            { label: 'Differences', value: 'diffs' },
            { label: 'All', value: 'all' },
          ]}
        />
        {extraFilters}
      </div>
    </div>
  )
}
