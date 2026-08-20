import { ArrowRightIcon } from 'lucide-react'

import type { ReactNode } from 'react'
import type { ComparePeer } from '@/lib/compare/scope'

import { ComparePeerSelect } from './compare-peer-select'
import { SegmentedControl } from '@/components/filters/segmented-control'
import { cn } from '@/lib/utils'

interface HostPairFilterProps {
  hosts: ComparePeer[]
  sourceHostId: number
  targetHostId: number
  showDiffsOnly?: boolean
  diffsOnlyLabel?: string
  onPairChange: (source: number, target: number) => void
  onShowDiffsOnlyChange?: (value: boolean) => void
  extraFilters?: ReactNode
  compact?: boolean
  className?: string
}

export function HostPairFilter({
  hosts,
  sourceHostId,
  targetHostId,
  showDiffsOnly,
  onPairChange,
  onShowDiffsOnlyChange,
  extraFilters,
  compact = false,
  className,
}: HostPairFilterProps) {
  const showDiffsToggle =
    showDiffsOnly !== undefined && onShowDiffsOnlyChange !== undefined

  return (
    <div
      className={cn(
        compact ? 'flex min-w-0 flex-1 flex-col gap-2' : 'flex flex-col gap-3',
        className
      )}
    >
      <div
        className={
          compact
            ? 'flex min-w-0 flex-wrap items-center gap-2'
            : 'flex flex-wrap items-end gap-2'
        }
      >
        <ComparePeerSelect
          label="Source"
          testId="compare-source"
          value={sourceHostId}
          hosts={hosts}
          compact={compact}
          onChange={(next) => {
            const nextTarget =
              next === targetHostId ? sourceHostId : targetHostId
            onPairChange(next, nextTarget)
          }}
        />
        <ArrowRightIcon
          className={
            compact
              ? 'hidden size-3.5 shrink-0 text-muted-foreground sm:block'
              : 'mb-3 hidden size-4 shrink-0 text-muted-foreground sm:block'
          }
          strokeWidth={1.5}
          aria-hidden
        />
        <ComparePeerSelect
          label="Target"
          testId="compare-target"
          value={targetHostId}
          hosts={hosts}
          compact={compact}
          onChange={(next) => {
            const nextSource =
              next === sourceHostId ? targetHostId : sourceHostId
            onPairChange(nextSource, next)
          }}
        />
      </div>
      {showDiffsToggle || extraFilters ? (
        <div className="flex flex-wrap items-center gap-2">
          {showDiffsToggle ? (
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
          ) : null}
          {extraFilters}
        </div>
      ) : null}
    </div>
  )
}
