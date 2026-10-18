import type { FocusEvent, KeyboardEvent } from 'react'

import {
  getArrowLeftAction,
  getArrowRightAction,
  getNextFocusIndex,
  type TreeArrowVerticalKey,
  type TreeNavItem,
} from '../tree/tree-keyboard-nav'
import { useCallback, useRef } from 'react'

const VERTICAL_KEYS: ReadonlySet<string> = new Set<TreeArrowVerticalKey>([
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
])

function getVisibleTreeItems(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[role="treeitem"]')
  ).filter((el) => el.getClientRects().length > 0)
}

/** `aria-level` is 1-indexed; our internal level (and `TreeNode`'s `level`
 * prop) is 0-indexed. */
function getLevel(el: HTMLElement): number {
  const raw = el.getAttribute('aria-level')
  const parsed = raw ? Number(raw) : 1
  return Number.isFinite(parsed) ? parsed - 1 : 0
}

function closestTreeItem(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  return target.closest<HTMLElement>('[role="treeitem"]')
}

/**
 * WAI-ARIA Tree View keyboard navigation and roving tabindex for a `role="tree"`.
 * Works on the live DOM because nodes mount, fetch, and expand independently, so
 * no single place owns the flattened visible list. Expand/collapse/activate click
 * the existing `[data-tree-toggle]` / `[data-tree-label]` buttons to reuse the
 * mouse logic.
 */
export function useTreeKeyboardNav() {
  const lastActiveRef = useRef<HTMLElement | null>(null)

  const handleFocus = useCallback((event: FocusEvent<HTMLElement>) => {
    const treeItem = closestTreeItem(event.target)
    if (!treeItem) return

    if (lastActiveRef.current && lastActiveRef.current !== treeItem) {
      lastActiveRef.current.tabIndex = -1
    }
    treeItem.tabIndex = 0
    lastActiveRef.current = treeItem
  }, [])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const treeItem = closestTreeItem(event.target)
    if (!treeItem) return
    const container = event.currentTarget

    if (VERTICAL_KEYS.has(event.key)) {
      const items = getVisibleTreeItems(container)
      const currentIndex = items.indexOf(treeItem)
      if (currentIndex === -1) return
      event.preventDefault()
      const nextIndex = getNextFocusIndex(
        currentIndex,
        items.length,
        event.key as TreeArrowVerticalKey
      )
      items[nextIndex]?.focus()
      return
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const items = getVisibleTreeItems(container)
      const currentIndex = items.indexOf(treeItem)
      if (currentIndex === -1) return
      event.preventDefault()

      const isExpanded = treeItem.getAttribute('aria-expanded') === 'true'
      const hasChildren = treeItem.hasAttribute('aria-expanded')
      const meta: TreeNavItem[] = items.map((el) => ({ level: getLevel(el) }))
      const action =
        event.key === 'ArrowRight'
          ? getArrowRightAction(meta, currentIndex, isExpanded, hasChildren)
          : getArrowLeftAction(meta, currentIndex, isExpanded, hasChildren)

      if (action.type === 'expand' || action.type === 'collapse') {
        // `treeItem`'s own toggle button is always rendered before its
        // (possibly nested-treeitem-containing) children in the DOM, so the
        // first descendant match is always this node's own toggle, never a
        // descendant's.
        treeItem
          .querySelector<HTMLButtonElement>('[data-tree-toggle="true"]')
          ?.click()
      } else if (action.type === 'focus') {
        items[action.index]?.focus()
      }
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      treeItem
        .querySelector<HTMLButtonElement>('[data-tree-label="true"]')
        ?.click()
    }
  }, [])

  return { handleKeyDown, handleFocus }
}
