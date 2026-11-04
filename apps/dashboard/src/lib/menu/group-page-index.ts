/**
 * Every page of one sidebar group, for the group hover flyout. Unlike the
 * rail, it ignores the workspace hide list: a hidden page is listed and
 * flagged, so the flyout can find what the sidebar leaves out. Keep React out
 * of this file.
 */

import type { MenuItem } from '@/components/menu/types'

export interface GroupPageEntry {
  item: MenuItem
  pinned: boolean
  inSidebar: boolean
}

/**
 * Pinned pages first (pin order), then pages in the sidebar, then pages hidden
 * from it, each in declaration order. Pins match by exact href, the same rule
 * as `useIsFavorite` and `buildGroupQuickLinks`.
 */
export function buildGroupPageIndex(
  children: readonly MenuItem[],
  favoriteHrefs: readonly string[],
  hiddenHrefs: ReadonlySet<string>
): GroupPageEntry[] {
  const pinRank = new Map(favoriteHrefs.map((href, i) => [href, i] as const))
  const entries = children
    .filter((item) => item.href)
    .map((item) => ({
      item,
      pinned: pinRank.has(item.href),
      inSidebar: !hiddenHrefs.has(item.href),
    }))
  const pinned = entries
    .filter((e) => e.pinned)
    .sort(
      (a, b) =>
        (pinRank.get(a.item.href) ?? 0) - (pinRank.get(b.item.href) ?? 0)
    )
  const rest = entries.filter((e) => !e.pinned)
  return [
    ...pinned,
    ...rest.filter((e) => e.inSidebar),
    ...rest.filter((e) => !e.inSidebar),
  ]
}
