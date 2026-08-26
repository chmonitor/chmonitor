import { Search } from 'lucide-react'
import { menuItemsConfig } from '@/menu'

import type { WorkspacePreset } from '@/lib/types/user-settings'

import { SegmentedControl } from './segmented-control'
import { WorkspaceMenuTree } from './workspace-menu-tree'
import { DEFAULT_SOURCE_ENGINE, type SourceEngine } from '@chm/types'
import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { getSettingsNavMenuItems } from '@/lib/menu/visible-items'
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
  dba: 'Tables, queries, SQL tools, merges, replication, disks, cluster, keeper, security.',
  engineer:
    'Overview, SQL/explorer, queries, insights. Less keeper, security, and ops.',
  sre: 'Overview, health, insights, SQL tools, replication, disks, errors, running queries.',
  custom:
    'Day-to-day pages by default. Hide or show more in the tree, or pick Full.',
}

interface WorkspacePresetPickerProps {
  preset: WorkspacePreset
  hiddenMenuHrefs: string[]
  /**
   * ACTIVE host engine — the same value the sidebar threads into
   * `getVisibleMenuItems`. Defaults to {@link DEFAULT_SOURCE_ENGINE} so
   * unspecified hosts keep today's tree.
   */
  engine?: SourceEngine
  onChange: (next: {
    workspacePreset: WorkspacePreset
    hiddenMenuHrefs: string[]
  }) => void
}

export function WorkspacePresetPicker({
  preset,
  hiddenMenuHrefs,
  engine = DEFAULT_SOURCE_ENGINE,
  onChange,
}: WorkspacePresetPickerProps) {
  const [query, setQuery] = useState('')

  const treeItems = useMemo(() => getSettingsNavMenuItems(engine), [engine])
  const leaves = useMemo(() => collectMenuLeaves(treeItems), [treeItems])
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

      {preset !== 'full' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-xs text-muted-foreground">
            {extraHiddenCount > 0
              ? `${extraHiddenCount} extra page${extraHiddenCount === 1 ? '' : 's'} hidden. Click Show on a row, or Show all.`
              : 'Hidden pages stay in this tree. Click Show on a row, or Show all.'}
          </p>
          <button
            type="button"
            data-testid="workspace-show-all"
            className="inline-flex h-8 w-fit shrink-0 items-center rounded-md border border-border px-3 text-[13px] font-medium hover:bg-muted"
            onClick={() => applyPreset('full')}
          >
            Show all
          </button>
        </div>
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
        resetKey={preset}
        onToggle={toggleHref}
      />
    </div>
  )
}
