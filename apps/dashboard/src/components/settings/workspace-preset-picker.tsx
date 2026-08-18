import { Search } from 'lucide-react'
import { menuItemsConfig } from '@/menu'

import type { WorkspacePreset } from '@/lib/types/user-settings'

import { SegmentedControl } from './segmented-control'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  collectMenuLeaves,
  hrefsOutsidePresetGroups,
  PRESET_GROUP_TITLES,
} from '@/lib/menu/workspace-presets'
import { cn } from '@/lib/utils'

const PRESET_OPTIONS: {
  value: WorkspacePreset
  label: string
}[] = [
  { value: 'full', label: 'Full' },
  { value: 'dba', label: 'DBA' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'sre', label: 'SRE' },
  { value: 'custom', label: 'Custom' },
]

const PRESET_HINT: Record<WorkspacePreset, string> = {
  full: 'Every page the host and deployment already allow. New pages stay visible.',
  dba: 'Tables, queries, merges, replication, disks, cluster, keeper, security.',
  engineer:
    'Overview, queries, SQL/explorer, insights. Less keeper, security, and ops.',
  sre: 'Overview, health, insights, replication, disks, errors, running queries.',
  custom:
    'Starts from a preset. Hide extra pages without a full checkbox wall.',
}

interface WorkspacePresetPickerProps {
  preset: WorkspacePreset
  hiddenMenuHrefs: string[]
  onChange: (next: {
    workspacePreset: WorkspacePreset
    hiddenMenuHrefs: string[]
  }) => void
}

export function WorkspacePresetPicker({
  preset,
  hiddenMenuHrefs,
  onChange,
}: WorkspacePresetPickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')

  const leaves = useMemo(() => collectMenuLeaves(menuItemsConfig), [])
  const hiddenSet = useMemo(() => new Set(hiddenMenuHrefs), [hiddenMenuHrefs])

  const applyPreset = (next: WorkspacePreset) => {
    if (next === 'full') {
      onChange({ workspacePreset: 'full', hiddenMenuHrefs: [] })
      return
    }
    if (next === 'custom') {
      if (preset !== 'full' && preset !== 'custom') {
        onChange({
          workspacePreset: 'custom',
          hiddenMenuHrefs: hrefsOutsidePresetGroups(
            menuItemsConfig,
            PRESET_GROUP_TITLES[preset]
          ),
        })
        return
      }
      onChange({ workspacePreset: 'custom', hiddenMenuHrefs })
      return
    }
    onChange({ workspacePreset: next, hiddenMenuHrefs: [] })
  }

  const hideHref = (href: string) => {
    const base =
      preset === 'full'
        ? []
        : preset === 'custom'
          ? hiddenMenuHrefs
          : hrefsOutsidePresetGroups(
              menuItemsConfig,
              PRESET_GROUP_TITLES[preset]
            )
    if (base.includes(href)) {
      onChange({ workspacePreset: 'custom', hiddenMenuHrefs: base })
      return
    }
    onChange({
      workspacePreset: 'custom',
      hiddenMenuHrefs: [...base, href],
    })
  }

  const showHref = (href: string) => {
    const next = hiddenMenuHrefs.filter((item) => item !== href)
    onChange({ workspacePreset: 'custom', hiddenMenuHrefs: next })
  }

  const filteredLeaves = leaves.filter((leaf) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      leaf.title.toLowerCase().includes(q) ||
      leaf.group.toLowerCase().includes(q) ||
      leaf.href.toLowerCase().includes(q)
    )
  })

  const hiddenLeaves = leaves.filter((leaf) => hiddenSet.has(leaf.href))

  return (
    <div className="space-y-3">
      <SegmentedControl
        ariaLabel="Workspace preset"
        value={preset}
        onChange={applyPreset}
        options={PRESET_OPTIONS}
      />
      <WorkspacePreview preset={preset} />
      <p className="text-xs text-muted-foreground">{PRESET_HINT[preset]}</p>

      {hiddenLeaves.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {hiddenLeaves.length} extra page
          {hiddenLeaves.length === 1 ? '' : 's'} hidden. Search to restore one.
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        onClick={() => setPickerOpen((open) => !open)}
      >
        {pickerOpen ? 'Close page list' : 'Hide pages…'}
      </Button>

      {pickerOpen && (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pages"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto">
            {filteredLeaves.map((leaf) => {
              const hidden = hiddenSet.has(leaf.href)
              return (
                <li key={leaf.href}>
                  <button
                    type="button"
                    onClick={() =>
                      hidden ? showHref(leaf.href) : hideHref(leaf.href)
                    }
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted',
                      hidden && 'text-muted-foreground'
                    )}
                  >
                    <span>
                      {leaf.title}
                      <span className="ml-1.5 text-[11px] text-muted-foreground">
                        {leaf.group}
                      </span>
                    </span>
                    <span className="text-[11px]">
                      {hidden ? 'Show' : 'Hide'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function WorkspacePreview({ preset }: { preset: WorkspacePreset }) {
  const rows =
    preset === 'dba'
      ? ['Queries', 'Tables', 'Keeper']
      : preset === 'engineer'
        ? ['Overview', 'Queries', 'Insights']
        : preset === 'sre'
          ? ['Health', 'Insights', 'Errors']
          : preset === 'custom'
            ? ['Overview', 'Queries']
            : ['Overview', 'Queries', 'Tables', 'Keeper']

  return (
    <div
      className="flex h-[72px] w-full max-w-[180px] flex-col gap-1 overflow-hidden rounded-lg bg-zinc-100 p-1.5 ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10"
      aria-hidden="true"
    >
      {rows.map((row) => (
        <div
          key={row}
          className="h-3 rounded-sm bg-foreground/15 px-1 text-[9px] leading-3 text-foreground/70"
        >
          {row}
        </div>
      ))}
    </div>
  )
}
