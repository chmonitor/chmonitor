import { describe, expect, it } from 'bun:test'
import {
  getArrowLeftAction,
  getArrowRightAction,
  getNextFocusIndex,
  type TreeNavItem,
} from './tree-keyboard-nav'

describe('getNextFocusIndex', () => {
  it('ArrowDown moves to the next item', () => {
    expect(getNextFocusIndex(1, 5, 'ArrowDown')).toBe(2)
  })

  it('ArrowDown clamps at the last item', () => {
    expect(getNextFocusIndex(4, 5, 'ArrowDown')).toBe(4)
  })

  it('ArrowUp moves to the previous item', () => {
    expect(getNextFocusIndex(2, 5, 'ArrowUp')).toBe(1)
  })

  it('ArrowUp clamps at the first item', () => {
    expect(getNextFocusIndex(0, 5, 'ArrowUp')).toBe(0)
  })

  it('Home jumps to the first item', () => {
    expect(getNextFocusIndex(3, 5, 'Home')).toBe(0)
  })

  it('End jumps to the last item', () => {
    expect(getNextFocusIndex(1, 5, 'End')).toBe(4)
  })

  it('returns -1 when there are no items', () => {
    expect(getNextFocusIndex(0, 0, 'ArrowDown')).toBe(-1)
  })
})

describe('getArrowRightAction', () => {
  // A tree shaped like:
  // 0: db (level 0)
  //   1: table (level 1)
  //     2: column (level 2)
  // 3: db2 (level 0, leaf-ish sibling with no children fetched yet)
  const items: TreeNavItem[] = [
    { level: 0 },
    { level: 1 },
    { level: 2 },
    { level: 0 },
  ]

  it('expands a closed node with children, focus stays put', () => {
    expect(getArrowRightAction(items, 0, false, true)).toEqual({
      type: 'expand',
    })
  })

  it('moves focus to the first child of an open node', () => {
    expect(getArrowRightAction(items, 0, true, true)).toEqual({
      type: 'focus',
      index: 1,
    })
  })

  it('does nothing on a leaf node', () => {
    expect(getArrowRightAction(items, 2, false, false)).toEqual({
      type: 'none',
    })
  })

  it('does nothing on an open node whose next item is a sibling, not a child', () => {
    // Index 1 (table, level 1) "open" but next item (index 2) is its own
    // child in this fixture, so use an open leafless table with no children
    // rendered yet (next item is a same-or-shallower-level sibling).
    const flatItems: TreeNavItem[] = [{ level: 0 }, { level: 0 }]
    expect(getArrowRightAction(flatItems, 0, true, true)).toEqual({
      type: 'none',
    })
  })

  it('does nothing on the last open node (no next item)', () => {
    expect(getArrowRightAction(items, 3, true, true)).toEqual({
      type: 'none',
    })
  })
})

describe('getArrowLeftAction', () => {
  const items: TreeNavItem[] = [
    { level: 0 },
    { level: 1 },
    { level: 2 },
    { level: 0 },
  ]

  it('collapses an open node with children, focus stays put', () => {
    expect(getArrowLeftAction(items, 0, true, true)).toEqual({
      type: 'collapse',
    })
  })

  it('moves focus to the parent of a closed node', () => {
    expect(getArrowLeftAction(items, 1, false, true)).toEqual({
      type: 'focus',
      index: 0,
    })
  })

  it('moves focus to the parent of a leaf node', () => {
    expect(getArrowLeftAction(items, 2, false, false)).toEqual({
      type: 'focus',
      index: 1,
    })
  })

  it('does nothing on a closed top-level (level 0) node', () => {
    expect(getArrowLeftAction(items, 0, false, true)).toEqual({
      type: 'none',
    })
  })

  it('does nothing on a top-level leaf node', () => {
    expect(getArrowLeftAction(items, 3, false, false)).toEqual({
      type: 'none',
    })
  })

  it('finds the nearest shallower ancestor, skipping same-level siblings', () => {
    // db(0) > table(1) > column(2) > column(2) — second column should walk
    // back to the table (level 1), not the first column (level 2).
    const nested: TreeNavItem[] = [
      { level: 0 },
      { level: 1 },
      { level: 2 },
      { level: 2 },
    ]
    expect(getArrowLeftAction(nested, 3, false, false)).toEqual({
      type: 'focus',
      index: 1,
    })
  })
})
