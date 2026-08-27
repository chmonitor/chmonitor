import type { MenuItem } from '@/components/menu/types'

import { collectMenuLeaves } from '@/lib/menu/workspace-presets'

function isFooterItem(item: MenuItem): boolean {
  return item.section === 'footer'
}

/**
 * The catalog group that owns `href` (Queries for `/running-queries`,
 * Tools for `/sql`). First match wins — Data Explorer is listed under
 * Tables then Tools; hover-Add on a Tables row uses Tables.
 */
export function findCatalogGroupForHref(
  items: readonly MenuItem[],
  href: string
): MenuItem | undefined {
  for (const item of items) {
    if (isFooterItem(item)) continue
    if (item.items?.length) {
      if (item.items.some((child) => child.href === href)) return item
      const nested = findCatalogGroupForHref(item.items, href)
      if (nested) return nested
    }
  }
  return undefined
}

/** Top-level (or nested) catalog group whose `title` matches. */
export function findCatalogGroupByTitle(
  items: readonly MenuItem[],
  title: string
): MenuItem | undefined {
  for (const item of items) {
    if (isFooterItem(item)) continue
    if (item.title === title && item.items?.length) return item
    if (item.items?.length) {
      const nested = findCatalogGroupByTitle(item.items, title)
      if (nested) return nested
    }
  }
  return undefined
}

/** Leaf children of a catalog group (skip nested folders). */
export function catalogGroupLeaves(group: MenuItem | undefined): MenuItem[] {
  if (!group?.items?.length) return []
  return group.items.filter(
    (child) => Boolean(child.href) && !child.items?.length
  )
}

/** Hidden leaves in the same catalog group as `href`, excluding `href`. */
export function hiddenSiblingLeaves(
  items: readonly MenuItem[],
  href: string,
  hiddenHrefs: ReadonlySet<string>
): MenuItem[] {
  const group = findCatalogGroupForHref(items, href)
  if (!group?.items?.length) return []
  return group.items.filter(
    (child) =>
      Boolean(child.href) &&
      child.href !== href &&
      !child.items?.length &&
      hiddenHrefs.has(child.href)
  )
}

export interface HiddenLeafGroup {
  group: string
  items: {
    href: string
    title: string
    description?: string
    icon?: MenuItem['icon']
  }[]
}

/**
 * Hidden catalog leaves grouped like the sidebar, deduped by href
 * (Explorer is listed once — Tables inventory first).
 */
export function hiddenLeavesGrouped(
  items: readonly MenuItem[],
  hiddenHrefs: ReadonlySet<string>
): HiddenLeafGroup[] {
  const seen = new Set<string>()
  const byGroup = new Map<string, HiddenLeafGroup['items']>()

  for (const leaf of collectMenuLeaves(items)) {
    if (!hiddenHrefs.has(leaf.href) || seen.has(leaf.href)) continue
    seen.add(leaf.href)
    const list = byGroup.get(leaf.group) ?? []
    const source = findLeaf(items, leaf.href)
    list.push({
      href: leaf.href,
      title: leaf.title,
      description: source?.description,
      icon: source?.icon,
    })
    byGroup.set(leaf.group, list)
  }

  return [...byGroup.entries()].map(([group, groupItems]) => ({
    group,
    items: groupItems,
  }))
}

function findLeaf(
  items: readonly MenuItem[],
  href: string
): MenuItem | undefined {
  for (const item of items) {
    if (item.href === href && !item.items?.length) return item
    if (item.items?.length) {
      const found = findLeaf(item.items, href)
      if (found) return found
    }
  }
  return undefined
}

export function pathnameMatchesMenuHref(
  pathname: string,
  href: string
): boolean {
  const path = pathname.split('?')[0]
  if (!href) return false
  return path === href || path === `${href}/`
}
