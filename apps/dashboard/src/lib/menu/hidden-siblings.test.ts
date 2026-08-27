import { menuItemsConfig } from '@/menu'

import { describe, expect, test } from 'bun:test'
import {
  findCatalogGroupForHref,
  hiddenLeavesGrouped,
  hiddenSiblingLeaves,
} from '@/lib/menu/hidden-siblings'
import { DEFAULT_HIDDEN_MENU_HREFS } from '@/lib/menu/slim-default'

describe('findCatalogGroupForHref', () => {
  test('Queries owns running-queries; Tools owns sql; Tables owns explorer first', () => {
    expect(
      findCatalogGroupForHref(menuItemsConfig, '/running-queries')?.title
    ).toBe('Queries')
    expect(findCatalogGroupForHref(menuItemsConfig, '/sql')?.title).toBe(
      'Tools'
    )
    expect(findCatalogGroupForHref(menuItemsConfig, '/explorer')?.title).toBe(
      'Tables'
    )
    expect(
      findCatalogGroupForHref(menuItemsConfig, '/overview')
    ).toBeUndefined()
  })
})

describe('hiddenSiblingLeaves', () => {
  const hidden = new Set(DEFAULT_HIDDEN_MENU_HREFS)

  test('Queries + lists History / Slow / Failed, not Running Queries', () => {
    const siblings = hiddenSiblingLeaves(
      menuItemsConfig,
      '/running-queries',
      hidden
    )
    const hrefs = siblings.map((item) => item.href)
    expect(hrefs).toContain('/history-queries')
    expect(hrefs).toContain('/slow-queries')
    expect(hrefs).toContain('/failed-queries')
    expect(hrefs).not.toContain('/running-queries')
  })

  test('Tables + lists Replicas, TTL, Explorer', () => {
    const hrefs = hiddenSiblingLeaves(
      menuItemsConfig,
      '/tables-overview',
      hidden
    ).map((item) => item.href)
    expect(hrefs).toContain('/replicas')
    expect(hrefs).toContain('/ttl-partition-health')
    expect(hrefs).toContain('/explorer')
    expect(hrefs).not.toContain('/tables-overview')
  })
})

describe('hiddenLeavesGrouped', () => {
  test('dedupes Explorer and groups like the catalog', () => {
    const groups = hiddenLeavesGrouped(
      menuItemsConfig,
      new Set(DEFAULT_HIDDEN_MENU_HREFS)
    )
    const explorerHits = groups.flatMap((group) =>
      group.items.filter((item) => item.href === '/explorer')
    )
    expect(explorerHits).toHaveLength(1)
    expect(groups.some((group) => group.group === 'Queries')).toBe(true)
    expect(groups.some((group) => group.group === 'Tables')).toBe(true)
  })
})
