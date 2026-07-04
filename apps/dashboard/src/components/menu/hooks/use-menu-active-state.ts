/**
 * Hook for detecting active menu item state
 *
 * Provides logic to determine if a menu item or its children are active.
 */

import type { MenuItem } from '../types'

import {
  isMenuItemActive,
  isMenuItemActiveAmongSiblings,
} from '@/lib/menu/breadcrumb'
import { usePathname } from '@/lib/next-compat'

/**
 * Check if a menu item or any of its children are active.
 *
 * `siblingHrefs`, when provided, scopes the item's own active check to
 * `isMenuItemActiveAmongSiblings` — pass the hrefs of the OTHER items
 * rendered alongside it (e.g. the other children of the same group) so a
 * shorter sibling href doesn't light up together with a more specific one
 * (e.g. "Chat" `/agents` vs "Agent Settings" `/agents/settings`).
 */
export function useMenuActiveState(
  item: MenuItem,
  siblingHrefs?: string[]
): boolean {
  const pathname = usePathname()

  return (() => {
    // Check if item itself is active
    if (item.href) {
      if (siblingHrefs) {
        return isMenuItemActiveAmongSiblings(item.href, siblingHrefs, pathname)
      }
      if (isMenuItemActive(item.href, pathname)) {
        return true
      }
    }

    // Check if any child is active
    if (item.items) {
      return item.items.some(
        (child) => child.href && isMenuItemActive(child.href, pathname)
      )
    }

    return false
  })()
}
