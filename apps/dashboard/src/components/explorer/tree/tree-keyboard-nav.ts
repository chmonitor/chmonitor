/**
 * Pure keyboard-navigation logic for the database explorer tree, implementing
 * the WAI-ARIA Tree View pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
 *
 * These functions are intentionally framework/DOM-free (no React, no
 * `document`) so they can be unit tested directly and reused by the DOM-glue
 * hook (`hooks/use-tree-keyboard-nav.ts`), which queries the live
 * `[role="treeitem"]` elements and hands their positions/levels in here.
 */

export type TreeArrowVerticalKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

/**
 * Up/Down move focus to the previous/next visible item (clamped at the
 * ends); Home/End jump to the first/last visible item.
 */
export function getNextFocusIndex(
  currentIndex: number,
  itemCount: number,
  key: TreeArrowVerticalKey
): number {
  if (itemCount <= 0) return -1

  switch (key) {
    case 'ArrowDown':
      return Math.min(currentIndex + 1, itemCount - 1)
    case 'ArrowUp':
      return Math.max(currentIndex - 1, 0)
    case 'Home':
      return 0
    case 'End':
      return itemCount - 1
    default:
      return currentIndex
  }
}

export interface TreeNavItem {
  /** 0-indexed nesting depth (database = 0, table = 1, column = 2). */
  level: number
}

export type TreeHorizontalAction =
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'focus'; index: number }
  | { type: 'none' }

/**
 * Right Arrow: expands a closed node (focus stays put); on an already-open
 * node, moves focus to its first child; does nothing on a leaf node.
 */
export function getArrowRightAction(
  items: readonly TreeNavItem[],
  currentIndex: number,
  isExpanded: boolean,
  hasChildren: boolean
): TreeHorizontalAction {
  if (!hasChildren) return { type: 'none' }
  if (!isExpanded) return { type: 'expand' }

  const current = items[currentIndex]
  const next = items[currentIndex + 1]
  if (current && next && next.level > current.level) {
    return { type: 'focus', index: currentIndex + 1 }
  }
  return { type: 'none' }
}

/**
 * Left Arrow: collapses an open node (focus stays put); on a closed node or
 * leaf, moves focus to the parent node; does nothing on a top-level
 * (level 0) closed/leaf node.
 */
export function getArrowLeftAction(
  items: readonly TreeNavItem[],
  currentIndex: number,
  isExpanded: boolean,
  hasChildren: boolean
): TreeHorizontalAction {
  const current = items[currentIndex]
  if (!current) return { type: 'none' }

  if (hasChildren && isExpanded) return { type: 'collapse' }
  if (current.level === 0) return { type: 'none' }

  for (let i = currentIndex - 1; i >= 0; i--) {
    const item = items[i]
    if (item && item.level < current.level) {
      return { type: 'focus', index: i }
    }
  }
  return { type: 'none' }
}
