import type { SchemaDiffHostInfo } from '@/lib/schema-diff'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

interface HostPairFilterProps {
  hosts: SchemaDiffHostInfo[]
  sourceHostId: number
  targetHostId: number
  nameFilter: string
  showDiffsOnly: boolean
  onPairChange: (source: number, target: number) => void
  onNameFilterChange: (value: string) => void
  onShowDiffsOnlyChange: (value: boolean) => void
}

export function HostPairFilter({
  hosts,
  sourceHostId,
  targetHostId,
  nameFilter,
  showDiffsOnly,
  onPairChange,
  onNameFilterChange,
  onShowDiffsOnlyChange,
}: HostPairFilterProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <label className="flex items-center gap-2 text-[13px]">
        <span className="text-muted-foreground">Source</span>
        <Select
          value={String(sourceHostId)}
          onValueChange={(value) => {
            if (value == null) return
            const next = Number(value)
            const nextTarget = next === targetHostId ? sourceHostId : targetHostId
            onPairChange(next, nextTarget)
          }}
        >
          <SelectTrigger size="sm" className="h-8 min-w-40 text-[13px]">
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
      <label className="flex items-center gap-2 text-[13px]">
        <span className="text-muted-foreground">Target</span>
        <Select
          value={String(targetHostId)}
          onValueChange={(value) => {
            if (value == null) return
            const next = Number(value)
            const nextSource = next === sourceHostId ? targetHostId : sourceHostId
            onPairChange(nextSource, next)
          }}
        >
          <SelectTrigger size="sm" className="h-8 min-w-40 text-[13px]">
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
      <Input
        placeholder="Filter tables…"
        value={nameFilter}
        onChange={(e) => onNameFilterChange(e.target.value)}
        className="h-8 w-full sm:w-64"
      />
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Switch checked={showDiffsOnly} onCheckedChange={onShowDiffsOnlyChange} />
        Differences only
      </label>
    </div>
  )
}
