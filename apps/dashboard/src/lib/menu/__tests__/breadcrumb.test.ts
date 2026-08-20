import { describe, expect, test } from 'bun:test'
import {
  getBreadcrumbPath,
  isMenuItemActive,
  isMenuItemActiveAmongSiblings,
} from '@/lib/menu/breadcrumb'

describe('isMenuItemActive', () => {
  test('exact match is active', () => {
    expect(isMenuItemActive('/agents', '/agents')).toBe(true)
  })

  test('parent path match is active (e.g. detail route under a list page)', () => {
    expect(isMenuItemActive('/tables', '/tables/some_db.some_table')).toBe(true)
  })

  test('unrelated path is not active', () => {
    expect(isMenuItemActive('/agents', '/overview')).toBe(false)
  })

  // Reproduces the reported bug: both "Chat" (/agents) and "Agent Settings"
  // (/agents/settings) light up on /agents/settings because /agents/settings
  // starts with "/agents/".
  test('a shorter sibling href prefix-matches a more specific sibling path', () => {
    expect(isMenuItemActive('/agents', '/agents/settings')).toBe(true)
  })
})

describe('isMenuItemActiveAmongSiblings', () => {
  const siblingHrefs = ['/agents', '/agents/settings', '/mcp']

  test('the sibling with an exact href match is active', () => {
    expect(
      isMenuItemActiveAmongSiblings(
        '/agents/settings',
        siblingHrefs,
        '/agents/settings'
      )
    ).toBe(true)
  })

  test('a shorter sibling href is NOT active when another sibling matches exactly', () => {
    expect(
      isMenuItemActiveAmongSiblings('/agents', siblingHrefs, '/agents/settings')
    ).toBe(false)
  })

  test('falls back to prefix matching when no sibling matches exactly', () => {
    expect(
      isMenuItemActiveAmongSiblings(
        '/agents',
        siblingHrefs,
        '/agents/settings/nested'
      )
    ).toBe(true)
  })

  test('the exact-match item itself is active on its own page', () => {
    expect(
      isMenuItemActiveAmongSiblings('/agents', siblingHrefs, '/agents')
    ).toBe(true)
  })
})

describe('getBreadcrumbPath (Inbound Events under Health, #3134)', () => {
  test('Inbound Events breadcrumbs go through Health, not as a top-level leaf', () => {
    expect(getBreadcrumbPath('/inbound-events')).toEqual([
      { title: 'Health', href: '' },
      { title: 'Inbound Events', href: '/inbound-events' },
    ])
  })
})

describe('getBreadcrumbPath (Tools regroup)', () => {
  test('Data Explorer breadcrumbs go through Tables (first parent; also listed under Tools)', () => {
    expect(getBreadcrumbPath('/explorer')).toEqual([
      { title: 'Tables', href: '/tables' },
      { title: 'Data Explorer', href: '/explorer' },
    ])
  })

  test('SQL Console breadcrumbs go through Tools, not Tables', () => {
    expect(getBreadcrumbPath('/sql')).toEqual([
      { title: 'Tools', href: '' },
      { title: 'SQL Console', href: '/sql' },
    ])
  })

  test('Explain breadcrumbs go through Tools, not Queries', () => {
    expect(getBreadcrumbPath('/explain')).toEqual([
      { title: 'Tools', href: '' },
      { title: 'Explain', href: '/explain' },
    ])
  })

  test('Chart Builder breadcrumbs go through Tools, not Operations', () => {
    expect(getBreadcrumbPath('/dashboard')).toEqual([
      { title: 'Tools', href: '' },
      { title: 'Chart Builder', href: '/dashboard' },
    ])
  })

  test('TTL & Partitions breadcrumbs go through Tables, not System', () => {
    expect(getBreadcrumbPath('/ttl-partition-health')).toEqual([
      { title: 'Tables', href: '/tables' },
      { title: 'TTL & Partitions', href: '/ttl-partition-health' },
    ])
  })
})
