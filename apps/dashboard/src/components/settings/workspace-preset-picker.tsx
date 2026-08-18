import { Search } from 'lucide-react'
import { menuItemsConfig } from '@/menu'

import type { WorkspacePreset } from '@/lib/types/user-settings'

import { SegmentedControl } from './segmented-control'
import { WorkspaceMenuTree } from './workspace-menu-tree'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { filterMenuItemsByEngine } from '@/lib/menu/visible-items'
import {
  applyWorkspacePreset,
  collectMenuLeaves,
  effectiveHiddenMenuHrefs,
  hideMenuHref,
  showMenuHref,
} from '@/lib/menu/workspace-presets'

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
  const [query, setQuery] = useState('')

  const treeItems = useMemo(
    () =>
      filterMenuItemsByEngine(menuItemsConfig, 'clickhouse').filter(
        (item) => item.section !== 'footer'
      ),
    []
  )
  const leaves = useMemo(() => collectMenuLeaves(menuItemsConfig), [])
  const workspace = useMemo(
    () => ({ workspacePreset: preset, hiddenMenuHrefs }),
    [preset, hiddenMenuHrefs]
  )
  const hiddenSet = useMemo(
    () => new Set(effectiveHiddenMenuHrefs(menuItemsConfig, workspace)),
    [workspace]
  )
  const extraHiddenCount = leaves.filter((leaf) =>
    hiddenMenuHrefs.includes(leaf.href)
  ).length

  const emit = (next: {
    workspacePreset: WorkspacePreset
    hiddenMenuHrefs: readonly string[]
  }) => {
    onChange({
      workspacePreset: next.workspacePreset,
      hiddenMenuHrefs: [...next.hiddenMenuHrefs],
    })
  }

  const applyPreset = (next: WorkspacePreset) => {
    emit(applyWorkspacePreset(menuItemsConfig, workspace, next))
  }

  const toggleHref = (href: string, hidden: boolean) => {
    emit(
      hidden
        ? showMenuHref(menuItemsConfig, workspace, href)
        : hideMenuHref(menuItemsConfig, workspace, href)
    )
  }

  return (
    <div className="space-y-3">
      <SegmentedControl
        ariaLabel="Workspace preset"
        value={preset}
        onChange={applyPreset}
        options={PRESET_OPTIONS}
      />
      <p className="text-xs text-muted-foreground">{PRESET_HINT[preset]}</p>

      {extraHiddenCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {extraHiddenCount} extra page
          {extraHiddenCount === 1 ? '' : 's'} hidden. Click Show to restore one.
        </p>
      )}

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

      <WorkspaceMenuTree
        items={treeItems}
        hiddenHrefs={hiddenSet}
        query={query}
        onToggle={toggleHref}
      />
    </div>
  )
}
