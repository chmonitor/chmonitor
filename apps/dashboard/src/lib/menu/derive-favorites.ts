/**
 * Derives the "Favorites" nav group and command-palette entries from pinned
 * hrefs (issue #2769). Favorites are never stored as a separate copy of menu
 * data — they are resolved against the live menu tree by href every render,
 * so a rename/removal of a route silently drops the stale pin instead of
 * rendering a broken link.
 */

import type { MenuItem } from '@/components/menu/types'

export function flattenMenuItems(items: readonly MenuItem[]): MenuItem[] {
  return items.flatMap((item) => {
    const children = item.items ? flattenMenuItems(item.items) : []
    return item.href ? [item, ...children] : children
  })
}

export function getFavoriteMenuItems(
  items: readonly MenuItem[],
  favoriteHrefs: readonly string[]
): MenuItem[] {
  const byHref = new Map(
    flattenMenuItems(items).map((item) => [item.href, item])
  )
  return favoriteHrefs
    .map((href) => byHref.get(href))
    .filter((item): item is MenuItem => item !== undefined)
}
