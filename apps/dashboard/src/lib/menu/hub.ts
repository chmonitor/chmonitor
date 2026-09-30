/**
 * Hub landing pages (/hub/<slug>): one per main task group. The page shows a
 * few key charts, then the group's pages as link cards split into sections.
 *
 * The card list is DERIVED from the menu config — a group's `hubHref` names
 * its hub and each child's `subgroup` names its section — so the hub can never
 * drift from the sidebar. Keep this file free of React so bun tests import it.
 */

import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

export interface HubSection {
  /** Section heading, from the children's `subgroup`. */
  name: string
  items: MenuItem[]
}

/** The group row whose `hubHref` is `hubHref`, if any. */
export function findHubGroup(
  hubHref: string,
  items: MenuItem[] = menuItemsConfig
): MenuItem | undefined {
  return items.find((item) => item.hubHref === hubHref)
}

/** Every group that declares a hub, in sidebar order. */
export function getHubGroups(items: MenuItem[] = menuItemsConfig): MenuItem[] {
  return items.filter((item) => Boolean(item.hubHref))
}

/**
 * Split a group's children into sections, in declaration order (first
 * appearance of each `subgroup`). A child without a `subgroup` lands in a
 * trailing "More" section so a new page is never silently dropped from a hub.
 */
export function getHubSections(group: MenuItem): HubSection[] {
  const sections: HubSection[] = []
  const byName = new Map<string, HubSection>()
  for (const child of group.items ?? []) {
    const name = child.subgroup ?? 'More'
    let section = byName.get(name)
    if (!section) {
      section = { name, items: [] }
      byName.set(name, section)
      sections.push(section)
    }
    section.items.push(child)
  }
  const more = byName.get('More')
  if (more && sections[sections.length - 1] !== more) {
    sections.splice(sections.indexOf(more), 1)
    sections.push(more)
  }
  return sections
}
