import type { MenuItem } from '@/components/menu/types'
import type { WorkspacePreset } from '@/lib/types/user-settings'

import {
  parseHiddenMenuHrefs,
  parseWorkspacePreset,
} from '@/lib/types/user-settings'

/**
 * Role workspace presets (issue #3077). Named presets keep a stable set of
 * top-level menu groups. Full is the only auto-expand preset: new pages and
 * groups appear there automatically. Footer rows (About) are
 * never hidden — they sit next to the Settings gear and Host switcher.
 *
 * First-run is Custom + the Essential leaf keep list (`slim-default.ts`),
 * not Full / DBA / Engineer / SRE. Role pills still dump whole groups onto
 * the rail (leftover — they are not leaf keep-lists that start from
 * Essential). Hide = sidebar / More membership; ⌘K uses the full allowed
 * catalog.
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
    'Tools',
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
  engineer: ['Overview', 'Tools', 'Queries', 'Tables', 'Insights', 'AI Agent'],
  sre: [
    'Overview',
    'Tools',
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

  if (workspacePreset === 'full' || workspacePreset === 'custom') {
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

/**
 * Hide list the customize tree should treat as muted: stored hrefs plus,
 * on a named preset, every leaf outside that preset's group set.
 */
export function effectiveHiddenMenuHrefs(
  items: readonly MenuItem[],
  workspace: WorkspaceVisibility
): string[] {
  if (
    workspace.workspacePreset === 'full' ||
    workspace.workspacePreset === 'custom'
  ) {
    return [...workspace.hiddenMenuHrefs]
  }

  const outside = hrefsOutsidePresetGroups(
    items,
    PRESET_GROUP_TITLES[workspace.workspacePreset]
  )
  return [...new Set([...outside, ...workspace.hiddenMenuHrefs])]
}

function hideListForPreset(
  items: readonly MenuItem[],
  workspace: WorkspaceVisibility
): string[] {
  if (workspace.workspacePreset === 'full') return []
  if (workspace.workspacePreset === 'custom') {
    return [...workspace.hiddenMenuHrefs]
  }
  return hrefsOutsidePresetGroups(
    items,
    PRESET_GROUP_TITLES[workspace.workspacePreset]
  )
}

/** Apply a role pill. Named presets clear the hide list; Custom materializes one. */
export function applyWorkspacePreset(
  items: readonly MenuItem[],
  current: WorkspaceVisibility,
  next: WorkspacePreset
): WorkspaceVisibility {
  if (next === 'full') {
    return { workspacePreset: 'full', hiddenMenuHrefs: [] }
  }
  if (next === 'custom') {
    if (
      current.workspacePreset !== 'full' &&
      current.workspacePreset !== 'custom'
    ) {
      return {
        workspacePreset: 'custom',
        hiddenMenuHrefs: hrefsOutsidePresetGroups(
          items,
          PRESET_GROUP_TITLES[current.workspacePreset]
        ),
      }
    }
    return {
      workspacePreset: 'custom',
      hiddenMenuHrefs: [...current.hiddenMenuHrefs],
    }
  }
  return { workspacePreset: next, hiddenMenuHrefs: [] }
}

function sameHrefSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const seen = new Set(a)
  return b.every((href) => seen.has(href))
}

/**
 * Custom only when `nextHidden` diverges from `hideListForPreset`.
 * Used by show: a no-op Show on a visible leaf stays on the named role.
 * Expand/collapse never calls these helpers.
 */
function materializeIfDiverged(
  items: readonly MenuItem[],
  current: WorkspaceVisibility,
  nextHidden: readonly string[]
): WorkspaceVisibility {
  if (current.workspacePreset === 'custom') {
    return { workspacePreset: 'custom', hiddenMenuHrefs: [...nextHidden] }
  }
  const roleHidden = hideListForPreset(items, current)
  if (sameHrefSet(roleHidden, nextHidden)) {
    return current
  }
  return { workspacePreset: 'custom', hiddenMenuHrefs: [...nextHidden] }
}

/** Hide a leaf. Custom only when the hide list leaves the current role. */
export function hideMenuHref(
  items: readonly MenuItem[],
  current: WorkspaceVisibility,
  href: string
): WorkspaceVisibility {
  const base = hideListForPreset(items, current)
  if (base.includes(href)) {
    return current
  }
  return { workspacePreset: 'custom', hiddenMenuHrefs: [...base, href] }
}

/** Show a leaf. Custom only when the hide list leaves the current role. */
export function showMenuHref(
  items: readonly MenuItem[],
  current: WorkspaceVisibility,
  href: string
): WorkspaceVisibility {
  const next = effectiveHiddenMenuHrefs(items, current).filter(
    (item) => item !== href
  )
  return materializeIfDiverged(items, current, next)
}

/** A parent is hidden when every descendant leaf is on the hide list. */
export function menuItemIsHidden(
  item: MenuItem,
  hidden: ReadonlySet<string>
): boolean {
  if (item.items?.length) {
    return item.items.every((child) => menuItemIsHidden(child, hidden))
  }
  return Boolean(item.href) && hidden.has(item.href)
}
