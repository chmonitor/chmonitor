/**
 * Keyboard selection for ⌘K: group headings and Hidden badges are not
 * navigable rows. cmdk's own filter reorders DOM nodes and can leave Enter
 * bound to the item *below* the highlighted row (#3346). Filter/rank here,
 * then activate `navigable[selectedIndex]` so Enter matches the highlight.
 */

import { defaultFilter } from 'cmdk'

import type { MenuItem } from '@/components/menu/types'

import { menuItemPaletteValue } from './command-palette-utils'

export interface PaletteHeaderRow {
  kind: 'header'
  id: string
  title: string
}

export interface PaletteItemRow {
  kind: 'item'
  id: string
  title: string
  href: string
  searchValue: string
  hidden?: boolean
  description?: string
}

export type PaletteRow = PaletteHeaderRow | PaletteItemRow

export interface PaletteItemGroup {
  heading?: string
  items: PaletteItemRow[]
}

/** Unique cmdk `value` so identity is not the long search haystack. */
export function paletteItemId(groupTitle: string, href: string): string {
  return `page:${groupTitle}:${href}`
}

export function paletteItemScore(searchValue: string, query: string): number {
  const q = query.trim()
  if (q.length === 0) return 1
  return defaultFilter(searchValue, q) ?? 0
}

export function matchesPaletteQuery(
  searchValue: string,
  query: string
): boolean {
  return paletteItemScore(searchValue, query) > 0
}

export function filterRankedByQuery<T>(
  items: readonly T[],
  query: string,
  searchValue: (item: T) => string
): T[] {
  const q = query.trim()
  const scored = items
    .map((item) => ({ item, score: paletteItemScore(searchValue(item), q) }))
    .filter(({ score }) => score > 0)
  if (q.length > 0) {
    scored.sort((a, b) => b.score - a.score)
  }
  return scored.map(({ item }) => item)
}

export function buildLeafPaletteRows(
  leafItems: readonly MenuItem[],
  hiddenHrefs?: ReadonlySet<string>
): PaletteRow[] {
  if (leafItems.length === 0) return []
  return [
    { kind: 'header', id: 'header:Go to', title: 'Go to' },
    ...leafItems.map((item) => menuItemToRow(item, 'Go to', hiddenHrefs)),
  ]
}

export function buildSectionedPaletteRows(
  sectionedItems: readonly MenuItem[],
  hiddenHrefs?: ReadonlySet<string>
): PaletteRow[] {
  const rows: PaletteRow[] = []
  for (const group of sectionedItems) {
    const children = group.items ?? []
    if (children.length === 0) continue
    rows.push({
      kind: 'header',
      id: `header:${group.title}`,
      title: group.title,
    })
    for (const item of children) {
      rows.push(menuItemToRow(item, group.title, hiddenHrefs))
    }
  }
  return rows
}

function menuItemToRow(
  item: MenuItem,
  groupTitle: string,
  hiddenHrefs?: ReadonlySet<string>
): PaletteItemRow {
  return {
    kind: 'item',
    id: paletteItemId(groupTitle, item.href),
    title: item.title,
    href: item.href,
    description: item.description,
    hidden: Boolean(hiddenHrefs?.has(item.href)),
    searchValue: menuItemPaletteValue(item, groupTitle),
  }
}

/**
 * Split a flattened palette list into heading + item groups. Headers are
 * labels only — they never occupy a `selectedIndex` slot.
 */
export function groupedPaletteRows(
  rows: readonly PaletteRow[]
): PaletteItemGroup[] {
  const groups: PaletteItemGroup[] = []
  for (const row of rows) {
    if (row.kind === 'header') {
      groups.push({ heading: row.title, items: [] })
      continue
    }
    const last = groups[groups.length - 1]
    if (!last) groups.push({ items: [row] })
    else last.items.push(row)
  }
  return groups.filter((group) => group.items.length > 0)
}

/**
 * Keep matching items, drop empty groups, and rank by cmdk's score so the
 * highlighted top row is the best match (e.g. Table Replicas for
 * `table replicas`). Hidden is a badge on the item, not its own row.
 */
export function filterPaletteRows(
  rows: readonly PaletteRow[],
  query: string
): PaletteRow[] {
  const q = query.trim()
  const ranked = groupedPaletteRows(rows)
    .map((group) => {
      const scored = group.items
        .map((item) => ({
          item,
          score: paletteItemScore(item.searchValue, q),
        }))
        .filter(({ score }) => score > 0)
      if (q.length > 0) {
        scored.sort((a, b) => b.score - a.score)
      }
      const items = scored.map(({ item }) => item)
      const maxScore = scored.reduce(
        (max, entry) => Math.max(max, entry.score),
        0
      )
      return { heading: group.heading, items, maxScore }
    })
    .filter((group) => group.items.length > 0)

  if (q.length > 0) {
    ranked.sort((a, b) => b.maxScore - a.maxScore)
  }

  const out: PaletteRow[] = []
  for (const group of ranked) {
    if (group.heading) {
      out.push({
        kind: 'header',
        id: `header:${group.heading}`,
        title: group.heading,
      })
    }
    out.push(...group.items)
  }
  return out
}

export function navigablePaletteRows(
  rows: readonly PaletteRow[]
): PaletteItemRow[] {
  return rows.filter((row): row is PaletteItemRow => row.kind === 'item')
}

export function stepPaletteIndex(
  selectedIndex: number,
  delta: number,
  count: number
): number {
  if (count <= 0) return 0
  return (((selectedIndex + delta) % count) + count) % count
}

/**
 * Enter / click target for the highlighted row. `selectedIndex` counts only
 * navigable items — never group headers or Hidden badges.
 */
export function activatePaletteRow(
  rows: readonly PaletteRow[],
  selectedIndex: number
): PaletteItemRow | undefined {
  const items = navigablePaletteRows(rows)
  if (items.length === 0) return undefined
  if (selectedIndex < 0 || selectedIndex >= items.length) return undefined
  return items[selectedIndex]
}
