/**
 * The sidebar's third level (#3676): group > subgroup > page.
 *
 * Subgroups are DERIVED from each child's `subgroup` field (the same field the
 * hubs use, lib/menu/hub.ts); the menu config never nests `items` in `items`.
 * Run this on a list that is already filtered for visibility, so hidden and
 * unavailable pages never hold a heading open. Keep this file free of React so
 * bun tests import it.
 */

import type { MenuItem } from '@/components/menu/types'

/** A group with this many visible pages or fewer renders as a flat list. */
export const FLAT_GROUP_MAX_PAGES = 6

export interface SubgroupSection {
  /** Heading for this run; absent means the pages render as plain rows. */
  subgroup?: string
  items: MenuItem[]
}

/**
 * Split a group's visible children into subgroup sections, in the order each
 * subgroup first appears.
 *
 * - A group with {@link FLAT_GROUP_MAX_PAGES} pages or fewer stays flat.
 * - A page without a `subgroup` renders directly under the group.
 * - A subgroup with one page renders as a plain row (no heading).
 * - A subgroup with no pages renders nothing.
 */
export function groupChildrenBySubgroup(
  items: readonly MenuItem[]
): SubgroupSection[] {
  if (items.length === 0) return []
  if (items.length <= FLAT_GROUP_MAX_PAGES) return [{ items: [...items] }]

  const sections: SubgroupSection[] = []
  const byName = new Map<string, SubgroupSection>()
  for (const item of items) {
    if (item.subgroup) {
      let section = byName.get(item.subgroup)
      if (!section) {
        section = { subgroup: item.subgroup, items: [] }
        byName.set(item.subgroup, section)
        sections.push(section)
      }
      section.items.push(item)
      continue
    }
    const last = sections[sections.length - 1]
    if (last && last.subgroup === undefined) last.items.push(item)
    else sections.push({ items: [item] })
  }

  // A single page under a heading is noise: demote it to a plain row, and
  // merge neighbouring plain runs so the output has no empty splits.
  const merged: SubgroupSection[] = []
  for (const section of sections) {
    const plain = section.subgroup === undefined || section.items.length < 2
    const last = merged[merged.length - 1]
    if (plain && last && last.subgroup === undefined) {
      last.items.push(...section.items)
    } else if (plain) {
      merged.push({ items: [...section.items] })
    } else {
      merged.push(section)
    }
  }
  return merged
}

export function subgroupKey(groupTitle: string, subgroup: string): string {
  return `${groupTitle}/${subgroup}`
}
