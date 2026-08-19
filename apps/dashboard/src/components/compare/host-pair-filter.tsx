import { ArrowRightIcon } from 'lucide-react'

import type { ReactNode } from 'react'
import type { ComparePeer } from '@/lib/compare/scope'

import { SegmentedControl } from '@/components/filters/segmented-control'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface HostPairFilterProps {
  hosts: ComparePeer[]
  sourceHostId: number
  targetHostId: number
  nameFilter: string
  nameFilterPlaceholder?: string
  showDiffsOnly: boolean
  diffsOnlyLabel?: string
  onPairChange: (source: number, target: number) => void
  onNameFilterChange: (value: string) => void
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
  const hostItems = Object.fromEntries(hosts.map((h) => [String(h.id), h.name]))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <PeerSelect
          label="Source"
          testId="compare-source"
          value={sourceHostId}
          hosts={hosts}
          items={hostItems}
          onChange={(next) => {
            const nextTarget =
              next === targetHostId ? sourceHostId : targetHostId
            onPairChange(next, nextTarget)
          }}
        />
        <ArrowRightIcon
          className="mb-2 hidden size-4 shrink-0 text-muted-foreground sm:block"
          strokeWidth={1.5}
          aria-hidden
        />
        <PeerSelect
          label="Target"
          testId="compare-target"
          value={targetHostId}
          hosts={hosts}
          items={hostItems}
          onChange={(next) => {
            const nextSource =
              next === sourceHostId ? targetHostId : sourceHostId
            onPairChange(nextSource, next)
          }}
        />
        <label className="flex min-w-48 flex-1 flex-col gap-1.5 sm:max-w-72">
          <span className="text-xs font-medium text-muted-foreground">
            Filter
          </span>
          <Input
            placeholder={nameFilterPlaceholder}
            value={nameFilter}
            onChange={(e) => onNameFilterChange(e.target.value)}
            className="h-9"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          size="default"
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

function PeerSelect({
  label,
  testId,
  value,
  hosts,
  items,
  onChange,
}: {
  label: string
  testId: string
  value: number
  hosts: ComparePeer[]
  items: Record<string, string>
  onChange: (next: number) => void
}) {
  return (
    <label className="flex min-w-48 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select
        value={String(value)}
        items={items}
        onValueChange={(next) => {
          if (next == null) return
          onChange(Number(next))
        }}
      >
        <SelectTrigger
          className="h-9 min-w-48 text-[13px] font-medium"
          data-testid={testId}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {hosts.map((h) => (
            <SelectItem key={h.id} value={String(h.id)}>
              {h.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
