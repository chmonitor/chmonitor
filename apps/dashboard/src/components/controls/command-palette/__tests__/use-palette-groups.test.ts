import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import {
  derivePaletteGroups,
  EXPLORER_GROUP_MAX,
} from '@/components/controls/command-palette/use-palette-groups'

function menuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    title: 'Overview',
    href: '/overview',
    ...overrides,
  } as MenuItem
}

describe('derivePaletteGroups', () => {
  test('empty query: no quick-nav match, leaf/sectioned items split correctly', () => {
    const menuItems = [
      menuItem({ title: 'Overview', href: '/overview' }),
      menuItem({
        title: 'Queries',
        href: '/queries',
        items: [menuItem({ title: 'Running', href: '/queries/running' })],
      }),
    ]
    const result = derivePaletteGroups({
      menuItems,
      favoriteMenuItems: [],
      tableRows: [],
      hosts: [],
      currentHostId: 0,
      query: '',
    })
    expect(result.leafItems.map((i) => i.href)).toEqual(['/overview'])
    expect(result.sectionedItems.map((i) => i.href)).toEqual(['/queries'])
    expect(result.quickNav.hasMatch).toBe(false)
  })

  test('a query matching a menu item does not affect the derived groups (cmdk filters)', () => {
    const menuItems = [menuItem({ title: 'Overview', href: '/overview' })]
    const result = derivePaletteGroups({
      menuItems,
      favoriteMenuItems: [],
      tableRows: [],
      hosts: [],
      currentHostId: 0,
      query: 'overview',
    })
    // Group derivation is query-independent — cmdk's own fuzzy filter narrows
    // the rendered rows, so the un-filtered menu item is still present here.
    expect(result.leafItems.map((i) => i.href)).toEqual(['/overview'])
  })

  test('a query matching a host id is excluded from otherHosts, not by query text', () => {
    const hosts = [
      { id: 0, name: 'primary', host: 'ch0.example.com' },
      { id: 1, name: 'secondary', host: 'ch1.example.com' },
    ]
    const result = derivePaletteGroups({
      menuItems: [],
      favoriteMenuItems: [],
      tableRows: [],
      hosts,
      currentHostId: 0,
      query: 'secondary',
    })
    expect(result.otherHosts.map((h) => h.id)).toEqual([1])
  })

  test('favorites ordering is preserved as given', () => {
    const favorites = [
      menuItem({ title: 'B', href: '/b' }),
      menuItem({ title: 'A', href: '/a' }),
    ]
    const result = derivePaletteGroups({
      menuItems: [],
      favoriteMenuItems: favorites,
      tableRows: [],
      hosts: [],
      currentHostId: 0,
      query: '',
    })
    expect(result.favoriteMenuItems.map((i) => i.href)).toEqual(['/b', '/a'])
  })

  test('EXPLORER_GROUP_MAX truncates databases and tables', () => {
    const tableRows = Array.from(
      { length: EXPLORER_GROUP_MAX + 5 },
      (_, i) => ({
        database: `db${i}`,
        name: `table${i}`,
        engine: 'MergeTree',
      })
    )
    const result = derivePaletteGroups({
      menuItems: [],
      favoriteMenuItems: [],
      tableRows,
      hosts: [],
      currentHostId: 0,
      query: '',
    })
    expect(result.databases.length).toBe(EXPLORER_GROUP_MAX)
    expect(result.tables.length).toBe(EXPLORER_GROUP_MAX)
  })

  test('detects query-id and table-name quick-nav from the query string', () => {
    const queryIdResult = derivePaletteGroups({
      menuItems: [],
      favoriteMenuItems: [],
      tableRows: [],
      hosts: [],
      currentHostId: 0,
      query: '12345678-1234-1234-1234-123456789012',
    })
    expect(queryIdResult.quickNav.isQueryId).toBe(true)

    const tableResult = derivePaletteGroups({
      menuItems: [],
      favoriteMenuItems: [],
      tableRows: [],
      hosts: [],
      currentHostId: 0,
      query: 'default.events',
    })
    expect(tableResult.quickNav.isTableName).toBe(true)
  })
})
