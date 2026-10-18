/**
 * Pure, DOM-free keyboard-navigation logic for the explorer tree (WAI-ARIA Tree
 * View pattern), so it can be unit tested directly.
 */

export type TreeArrowVerticalKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

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
  level: number
}

export type TreeHorizontalAction =
  | { type: 'expand' }
  | { type: 'collapse' }
  | { type: 'focus'; index: number }
  | { type: 'none' }

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
