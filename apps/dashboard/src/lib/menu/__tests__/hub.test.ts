/**
 * Hub pages (/hub/<slug>) promise "one click to any page in the group". Their
 * cards are derived from the menu config, so these tests guard the config:
 * every card must go to a real page, every page must be on a hub, and every
 * hub must have a route and a chart strip that links back into its group.
 */

import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getGroupHubHref } from '@/lib/menu/group-hub'
import { findHubGroup, getHubGroups, getHubSections } from '@/lib/menu/hub'
import { OG_PAGES } from '@/lib/og'
import { HUB_CHARTS } from '@/routes/(dashboard)/hub/-hub-charts'

const ROUTES_DIR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../routes/(dashboard)'
)

function leafHrefs(items: MenuItem[], out: Set<string> = new Set()) {
  for (const item of items) {
    if (item.items?.length) leafHrefs(item.items, out)
    else if (item.href) out.add(item.href)
  }
  return out
}

const MENU_HREFS = leafHrefs(menuItemsConfig)
const hubs = getHubGroups()

describe('hub groups', () => {
  test('the four task groups each declare a hub', () => {
    expect(hubs.map((g) => [g.title, g.hubHref])).toEqual([
      ['Queries', '/hub/queries'],
      ['Data & Storage', '/hub/data-storage'],
      ['Cluster & Replication', '/hub/cluster-replication'],
      ['Server', '/hub/server'],
    ])
  })

  // The sidebar row link, breadcrumb crumb, and group flyout all read the
  // hub through getGroupHubHref — it must agree with the menu config.
  test('getGroupHubHref resolves each group title to its hub', () => {
    for (const group of hubs) {
      expect(getGroupHubHref(group.title)).toBe(group.hubHref)
    }
    expect(getGroupHubHref('Tools & AI')).toBeUndefined()
    expect(getGroupHubHref('Running Queries')).toBeUndefined()
  })

  test.each(
    hubs.map((g) => [g.hubHref as string])
  )('%s has a route file and an OG page', (hubHref) => {
    const slug = hubHref.replace('/hub/', '')
    expect(existsSync(join(ROUTES_DIR, 'hub', `${slug}.tsx`))).toBe(true)
    expect(OG_PAGES[`hub-${slug}`]).toBeDefined()
  })
})

describe('hub sections', () => {
  test.each(
    hubs.map((g) => [g.title, g])
  )('every %s page has a subgroup (none falls into "More")', (_title, group) => {
    const missing = (group.items ?? [])
      .filter((child) => !child.subgroup)
      .map((child) => child.title)
    expect(missing).toEqual([])
  })

  test.each(
    hubs.map((g) => [g.title, g])
  )('every %s hub card resolves to a real menu href', (_title, group) => {
    const cards = getHubSections(group).flatMap((s) => s.items)
    expect(cards.length).toBe(group.items?.length ?? 0)
    for (const card of cards) {
      expect(MENU_HREFS.has(card.href), card.title).toBe(true)
    }
  })

  test('Keeper is its own section under Cluster & Replication', () => {
    const group = findHubGroup('/hub/cluster-replication')
    const names = group ? getHubSections(group).map((s) => s.name) : []
    expect(names).toEqual(['Cluster', 'Replication', 'Keeper'])
  })

  test('sections keep declaration order and group non-adjacent children', () => {
    const group: MenuItem = {
      title: 'G',
      href: '',
      items: [
        { title: 'a', href: '/a', subgroup: 'X' },
        { title: 'b', href: '/b' },
        { title: 'c', href: '/c', subgroup: 'Y' },
        { title: 'd', href: '/d', subgroup: 'X' },
      ],
    }
    expect(
      getHubSections(group).map((s) => [s.name, s.items.map((i) => i.title)])
    ).toEqual([
      ['X', ['a', 'd']],
      ['Y', ['c']],
      ['More', ['b']],
    ])
  })
})

describe('hub charts', () => {
  test.each(
    hubs.map((g) => [g.hubHref as string, g])
  )('%s shows 3-4 key charts whose titles link into the group', (hubHref, group) => {
    const charts = HUB_CHARTS[hubHref] ?? []
    expect(charts.length).toBeGreaterThanOrEqual(3)
    expect(charts.length).toBeLessThanOrEqual(4)
    const groupHrefs = leafHrefs(group.items ?? [])
    for (const chart of charts) {
      expect(groupHrefs.has(chart.href), chart.id).toBe(true)
    }
  })
})
