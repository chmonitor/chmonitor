import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

export interface BreadcrumbItem {
  title: string
  /** Empty string means this item is a non-navigable section label */
  href: string
}

/**
 * Convert a URL path segment to a human-readable title.
 * Used as a fallback when a page is not registered in the menu.
 */
function segmentToTitle(segment: string): string {
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Build a breadcrumb path from raw URL segments when no menu match is found.
 * Each segment becomes a breadcrumb item with its cumulative href.
 */
function buildFallbackPath(normalizedPath: string): BreadcrumbItem[] {
  const segments = normalizedPath.split('/').filter(Boolean)
  if (segments.length === 0) return []

  return segments.map((segment, index) => ({
    title: segmentToTitle(segment),
    href: `/${segments.slice(0, index + 1).join('/')}`,
  }))
}

/**
 * Find the breadcrumb path for a given pathname.
 * Searches through the menu hierarchy first; falls back to URL segment parsing
 * when the page is not registered in the menu.
 *
 * Parent menu items with href: '' are included as non-navigable section labels.
 */
export function getBreadcrumbPath(
  pathname: string,
  items: MenuItem[] = menuItemsConfig
): BreadcrumbItem[] {
  const result: BreadcrumbItem[] = []
  const normalizedPath = pathname.split('?')[0] // Remove query params

  function searchItems(items: MenuItem[], path: BreadcrumbItem[]): boolean {
    for (const item of items) {
      const currentPath: BreadcrumbItem[] = [
        ...path,
        { title: item.title, href: item.href },
      ]

      // Check if this item matches the current pathname (skip empty-href group headers)
      if (item.href && item.href === normalizedPath) {
        result.push(...currentPath)
        return true
      }

      // Check if any children match
      if (item.items) {
        if (searchItems(item.items, currentPath)) {
          return true
        }
      }
    }
    return false
  }

  const found = searchItems(items, [])

  if (!found) {
    // Fallback: derive breadcrumbs from URL path segments
    return buildFallbackPath(normalizedPath)
  }

  return result
}

/**
 * Check if a menu item is active for the current pathname
 */
export function isMenuItemActive(itemHref: string, pathname: string): boolean {
  const normalizedPath = pathname.split('?')[0]
  const normalizedHref = itemHref.split('?')[0]

  // Exact match
  if (normalizedHref === normalizedPath) {
    return true
  }

  // Parent path match (e.g., /tables matches /table)
  if (
    normalizedPath.startsWith(`${normalizedHref}/`) ||
    normalizedPath.startsWith(`${normalizedHref}?`)
  ) {
    return true
  }

  return false
}

/**
 * Active-match for one item among a known list of sibling hrefs (e.g. the
 * children of the same collapsible menu group).
 *
 * `isMenuItemActive`'s parent-path rule (`/agents` matches `/agents/settings`)
 * is correct when a page has an unregistered detail route nested under it,
 * but wrong when the "nested" path is itself a SIBLING menu entry — e.g.
 * "Chat" (`/agents`) and "Agent Settings" (`/agents/settings`) both live under
 * the same "AI Agent" group, so `/agents/settings` would light up both. Rule:
 * an exact href match among the siblings always wins; only fall back to the
 * parent-path heuristic when no sibling matches the pathname exactly.
 */
export function isMenuItemActiveAmongSiblings(
  itemHref: string,
  siblingHrefs: string[],
  pathname: string
): boolean {
  const normalizedPath = pathname.split('?')[0]
  const exactSibling = siblingHrefs.find(
    (href) => href.split('?')[0] === normalizedPath
  )
  if (exactSibling !== undefined) {
    return exactSibling === itemHref
  }
  return isMenuItemActive(itemHref, pathname)
}
