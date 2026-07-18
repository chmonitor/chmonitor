import type { MenuItem } from '@/components/menu/types'

import { flattenMenuItems, getFavoriteMenuItems } from './derive-favorites'
import { describe, expect, test } from 'bun:test'

const FIXTURE_MENU: MenuItem[] = [
  { title: 'Overview', href: '/overview', section: 'main' },
  { title: 'Traffic', href: '/traffic', section: 'main' },
  {
    // Group header — no own href, so it's not independently favoritable, but
    // its children are.
    title: 'Queries',
    href: '',
    section: 'main',
    items: [
      { title: 'Running Queries', href: '/running-queries' },
      { title: 'History Queries', href: '/history-queries' },
    ],
  },
  {
    title: 'Tables',
    href: '/tables',
    section: 'main',
    items: [{ title: 'Data Explorer', href: '/explorer' }],
  },
]

describe('flattenMenuItems', () => {
  test('drops group headers with an empty href', () => {
    const flat = flattenMenuItems(FIXTURE_MENU)
    expect(flat.some((item) => item.title === 'Queries')).toBe(false)
  })

  test('includes both a parent with its own href and its children', () => {
    const flat = flattenMenuItems(FIXTURE_MENU)
    expect(flat.map((item) => item.href)).toEqual(
      expect.arrayContaining(['/tables', '/explorer'])
    )
  })

  test('includes nested children of an href-less group header', () => {
    const flat = flattenMenuItems(FIXTURE_MENU)
    expect(flat.map((item) => item.href)).toEqual(
      expect.arrayContaining(['/running-queries', '/history-queries'])
    )
  })

  test('flattens a plain leaf-only menu unchanged', () => {
    const flat = flattenMenuItems(FIXTURE_MENU)
    expect(flat.find((item) => item.href === '/overview')?.title).toBe(
      'Overview'
    )
  })
})

describe('getFavoriteMenuItems', () => {
  test('resolves favorites in pin order, not menu order', () => {
    const favorites = getFavoriteMenuItems(FIXTURE_MENU, [
      '/explorer',
      '/overview',
    ])
    expect(favorites.map((item) => item.href)).toEqual([
      '/explorer',
      '/overview',
    ])
  })

  test('resolves a favorited nested sub-item by href', () => {
    const favorites = getFavoriteMenuItems(FIXTURE_MENU, ['/running-queries'])
    expect(favorites).toHaveLength(1)
    expect(favorites[0].title).toBe('Running Queries')
  })

  test('silently drops a pinned href that no longer exists in the menu', () => {
    const favorites = getFavoriteMenuItems(FIXTURE_MENU, [
      '/overview',
      '/renamed-or-removed-route',
      '/traffic',
    ])
    expect(favorites.map((item) => item.href)).toEqual([
      '/overview',
      '/traffic',
    ])
  })

  test('returns an empty array when no favorites are pinned', () => {
    expect(getFavoriteMenuItems(FIXTURE_MENU, [])).toEqual([])
  })

  test('returns an empty array when every pinned href is stale', () => {
    expect(getFavoriteMenuItems(FIXTURE_MENU, ['/nope', '/also-nope'])).toEqual(
      []
    )
  })

  test('a group header href (empty string) can never be favorited', () => {
    // Even if somehow persisted, an empty-string href must never match.
    const menuWithEmptyHref: MenuItem[] = [
      { title: 'Queries', href: '', section: 'main' },
    ]
    expect(getFavoriteMenuItems(menuWithEmptyHref, [''])).toEqual([])
  })
})
