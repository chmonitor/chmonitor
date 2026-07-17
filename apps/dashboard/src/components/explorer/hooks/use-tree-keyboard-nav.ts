import { useCallback, useRef } from 'react'

import type { FocusEvent, KeyboardEvent } from 'react'

import {
  getArrowLeftAction,
  getArrowRightAction,
  getNextFocusIndex,
  type TreeArrowVerticalKey,
  type TreeNavItem,
} from '../tree/tree-keyboard-nav'

const VERTICAL_KEYS: ReadonlySet<string> = new Set<TreeArrowVerticalKey>([
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
])

/** Visible (not inside a collapsed ancestor) treeitems, in document order. */
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
 * Wires WAI-ARIA Tree View keyboard navigation + roving tabindex onto a
 * `role="tree"` container: https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
 *
 * - Up/Down/Home/End move focus between visible treeitems.
 * - Right expands a closed node (or moves into its first child if already open).
 * - Left collapses an open node (or moves focus to the parent).
 * - Enter/Space activates the node (clicks its label, same as a mouse click).
 *
 * Operates on the live DOM (`querySelectorAll('[role="treeitem"]')`) rather
 * than a React-side registry, since `DatabaseNode`/`TableNode`/`ColumnNode`
 * mount, fetch, and expand independently of one another — there is no single
 * place that owns the full flattened list of currently-visible nodes.
 *
 * Expand/collapse/activate are triggered by clicking the underlying
 * `[data-tree-toggle]` / `[data-tree-label]` buttons so all existing
 * mouse-click logic (fetch-on-expand, `expandOnSelect`, selection) is reused
 * verbatim rather than duplicated here.
 */
export function useTreeKeyboardNav() {
  // Tracks the roving-tabindex anchor without forcing a React re-render on
  // every focus change — mirrors the standard "manual roving tabindex" recipe.
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
