import { useLocation } from '@tanstack/react-router'

import type { MenuItem } from '../types'

import {
  isMenuItemActive,
  isMenuItemActiveAmongSiblings,
} from '@/lib/menu/breadcrumb'

/**
 * Pass the OTHER items' hrefs as `siblingHrefs` so a shorter sibling
 * (`/agents`) stays inactive on `/agents/settings`.
 */
export function useMenuActiveState(
  item: MenuItem,
  siblingHrefs?: string[]
): boolean {
  const pathname = useLocation({ select: (l) => l.pathname })

  return (() => {
    if (item.href) {
      if (siblingHrefs) {
        return isMenuItemActiveAmongSiblings(item.href, siblingHrefs, pathname)
      }
      if (isMenuItemActive(item.href, pathname)) {
        return true
      }
    }

    if (item.items) {
      return item.items.some(
        (child) => child.href && isMenuItemActive(child.href, pathname)
      )
    }

    return false
  })()
}
