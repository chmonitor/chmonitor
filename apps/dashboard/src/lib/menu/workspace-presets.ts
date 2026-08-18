import type { MenuItem } from '@/components/menu/types'
import type { WorkspacePreset } from '@/lib/types/user-settings'

import {
  parseHiddenMenuHrefs,
  parseWorkspacePreset,
} from '@/lib/types/user-settings'

/**
 * Role workspace presets (issue #3077). Named presets keep a stable set of
 * top-level menu groups. Full is the only auto-expand preset: new pages and
 * groups appear there automatically. Footer rows (About / Organization) are
 * never hidden — they sit next to the Settings gear and Host switcher.
 */

export const WORKSPACE_PRESETS = [
  'full',
  'dba',
  'engineer',
  'sre',
  'custom',
] as const

export interface WorkspaceVisibility {
  workspacePreset: WorkspacePreset
  hiddenMenuHrefs: readonly string[]
}

/** Top-level `MenuItem.title` values kept by each named preset. */
export const PRESET_GROUP_TITLES: Record<
  Exclude<WorkspacePreset, 'full' | 'custom'>,
  readonly string[]
> = {
  dba: [
    'Overview',
    'Queries',
    'Tables',
    'Merges',
    'Metrics',
    'Keeper',
    'Security',
    'Logs',
    'Cluster',
    'System',
  ],
  engineer: ['Overview', 'Queries', 'Tables', 'Insights', 'AI Agent'],
  sre: [
    'Overview',
    'Health',
    'Insights',
    'Queries',
    'Tables',
    'System',
    'Operations',
    'Metrics',
    'Logs',
  ],
}

function isFooterItem(item: MenuItem): boolean {
  return item.section === 'footer'
}

function isHiddenByHref(item: MenuItem, hidden: ReadonlySet<string>): boolean {
  if (!item.href) return false
  return hidden.has(item.href)
}

/**
 * Drop items whose href is on the hide list (and any parent left empty).
 * Footer items are never removed. Recursive, same empty-parent rule as
 * `filterCloudOnly`.
 */
export function filterHiddenMenuHrefs(
  items: readonly MenuItem[],
  hiddenHrefs: readonly string[]
): MenuItem[] {
  if (hiddenHrefs.length === 0) return items.map((item) => ({ ...item }))

  const hidden = new Set(hiddenHrefs)
  return items.flatMap((item) => {
    if (isFooterItem(item)) return [{ ...item }]
    if (isHiddenByHref(item, hidden)) return []

    if (!item.items) return [{ ...item }]

    const childItems = filterHiddenMenuHrefs(item.items, hiddenHrefs)
    if (childItems.length === 0) return []
    return [{ ...item, items: childItems }]
  })
}

/**
 * Keep only top-level groups whose title is in `allowedTitles`. Footer rows
 * always survive. Empty parents after child filtering are dropped.
 */
export function filterMenuItemsByGroupTitles(
  items: readonly MenuItem[],
  allowedTitles: readonly string[]
): MenuItem[] {
  const allowed = new Set(allowedTitles)
  return items.flatMap((item) => {
    if (isFooterItem(item)) return [{ ...item }]
    if (!allowed.has(item.title)) return []
    return [{ ...item }]
  })
}

export function applyWorkspaceVisibility(
  items: readonly MenuItem[],
  workspace: WorkspaceVisibility
): MenuItem[] {
  const { workspacePreset, hiddenMenuHrefs } = workspace

  if (workspacePreset === 'full') {
    return filterHiddenMenuHrefs(items, hiddenMenuHrefs)
  }

  if (workspacePreset === 'custom') {
    return filterHiddenMenuHrefs(items, hiddenMenuHrefs)
  }

  const byGroup = filterMenuItemsByGroupTitles(
    items,
    PRESET_GROUP_TITLES[workspacePreset]
  )
  return filterHiddenMenuHrefs(byGroup, hiddenMenuHrefs)
}

/** Flatten leaf hrefs for the customize picker (skip empty parent hrefs). */
export function hrefsOutsidePresetGroups(
  items: readonly MenuItem[],
  allowedTitles: readonly string[]
): string[] {
  const allowed = new Set(allowedTitles)
  const hrefs: string[] = []
  for (const item of items) {
    if (isFooterItem(item)) continue
    if (allowed.has(item.title)) continue
    hrefs.push(...collectMenuHrefs([item]))
  }
  return hrefs
}

export function collectMenuHrefs(items: readonly MenuItem[]): string[] {
  const hrefs: string[] = []
  for (const item of items) {
    if (item.href) hrefs.push(item.href)
    if (item.items) hrefs.push(...collectMenuHrefs(item.items))
  }
  return hrefs
}

export function collectMenuLeaves(
  items: readonly MenuItem[]
): { href: string; title: string; group: string }[] {
  const leaves: { href: string; title: string; group: string }[] = []

  const walk = (nodes: readonly MenuItem[], group: string) => {
    for (const item of nodes) {
      const nextGroup = group || item.title
      if (item.items?.length) {
        walk(item.items, nextGroup)
        continue
      }
      if (item.href && !isFooterItem(item)) {
        leaves.push({ href: item.href, title: item.title, group: nextGroup })
      }
    }
  }

  walk(items, '')
  return leaves
}

export function workspaceFromSettings(settings: {
  workspacePreset?: unknown
  hiddenMenuHrefs?: unknown
}): WorkspaceVisibility {
  return {
    workspacePreset: parseWorkspacePreset(settings.workspacePreset),
    hiddenMenuHrefs: parseHiddenMenuHrefs(settings.hiddenMenuHrefs),
  }
}
