import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import {
  filterCloudOnly,
  filterMenuItemsByEngine,
} from '@/lib/menu/visible-items'

const leaf = (overrides: Partial<MenuItem> = {}): MenuItem => ({
  title: overrides.title ?? 'Item',
  href: overrides.href ?? '/item',
  ...overrides,
})

describe('filterCloudOnly', () => {
  test('drops a cloudOnly leaf in self-host / OSS (the reported bug)', () => {
    const items = [
      leaf({ title: 'Overview', href: '/overview' }),
      leaf({ title: 'Billing', href: '/billing', cloudOnly: true }),
      leaf({ title: 'Organization', href: '/organization', cloudOnly: true }),
    ]

    expect(filterCloudOnly(items, false).map((i) => i.title)).toEqual([
      'Overview',
    ])
  })

  test('keeps cloudOnly items in cloud mode', () => {
    const items = [
      leaf({ title: 'Overview', href: '/overview' }),
      leaf({ title: 'Billing', href: '/billing', cloudOnly: true }),
    ]

    expect(filterCloudOnly(items, true).map((i) => i.title)).toEqual([
      'Overview',
      'Billing',
    ])
  })

  test('removes a parent group whose only children are cloudOnly in OSS', () => {
    const items: MenuItem[] = [
      {
        title: 'Cloud',
        href: '',
        items: [
          leaf({ title: 'Billing', href: '/billing', cloudOnly: true }),
          leaf({
            title: 'Organization',
            href: '/organization',
            cloudOnly: true,
          }),
        ],
      },
    ]

    expect(filterCloudOnly(items, false)).toEqual([])
  })

  test('keeps a parent group when some non-cloud children survive', () => {
    const items: MenuItem[] = [
      {
        title: 'Mixed',
        href: '',
        items: [
          leaf({ title: 'Overview', href: '/overview' }),
          leaf({ title: 'Billing', href: '/billing', cloudOnly: true }),
        ],
      },
    ]

    const result = filterCloudOnly(items, false)
    expect(result).toHaveLength(1)
    expect(result[0].items?.map((i) => i.title)).toEqual(['Overview'])
  })

  test('non-cloudOnly items are untouched in either mode', () => {
    const items = [leaf({ title: 'Health', href: '/health' })]

    expect(filterCloudOnly(items, false).map((i) => i.title)).toEqual([
      'Health',
    ])
    expect(filterCloudOnly(items, true).map((i) => i.title)).toEqual(['Health'])
  })
})

// Intent guard: Billing + Organization MUST be marked cloudOnly so every nav
// surface (sidebar, command palette, …) hides them in self-host / OSS. If this
// fails, someone added a cloud surface without the flag and self-hosters will
// see non-functional SaaS menu items again.
describe('menu config cloud-only contract', () => {
  const find = (href: string) =>
    menuItemsConfig.find((item) => item.href === href)

  test('Billing is cloud-only', () => {
    expect(find('/billing')?.cloudOnly).toBe(true)
  })

  test('Organization is cloud-only', () => {
    expect(find('/organization')?.cloudOnly).toBe(true)
  })

  test('Billing + Organization are hidden when filtering the real config in OSS', () => {
    const titles = filterCloudOnly(menuItemsConfig, false).map((i) => i.title)
    expect(titles).not.toContain('Billing')
    expect(titles).not.toContain('Organization')
  })
})

// Engine-aware menu swap (issue #2450, decision 4). The HARD invariant: for the
// ClickHouse family the menu is byte-for-byte today's menu; for Postgres only
// the Postgres-tagged items show.
describe('filterMenuItemsByEngine', () => {
  test('absent `engines` = ClickHouse family only', () => {
    const items = [
      leaf({ title: 'Overview', href: '/overview' }),
      leaf({ title: 'PG', href: '/postgres/queries', engines: ['postgres'] }),
    ]
    expect(
      filterMenuItemsByEngine(items, 'clickhouse').map((i) => i.title)
    ).toEqual(['Overview'])
    expect(
      filterMenuItemsByEngine(items, 'clickhouse-cloud').map((i) => i.title)
    ).toEqual(['Overview'])
    expect(
      filterMenuItemsByEngine(items, 'postgres').map((i) => i.title)
    ).toEqual(['PG'])
  })

  test('drops a parent group left empty for the engine', () => {
    const items: MenuItem[] = [
      {
        title: 'Queries',
        href: '',
        items: [leaf({ title: 'Running', href: '/running-queries' })],
      },
      {
        title: 'Postgres',
        href: '',
        engines: ['postgres'],
        items: [
          leaf({
            title: 'PG Queries',
            href: '/postgres/queries',
            engines: ['postgres'],
          }),
        ],
      },
    ]
    // ClickHouse: CH group kept, Postgres group dropped entirely.
    expect(
      filterMenuItemsByEngine(items, 'clickhouse').map((i) => i.title)
    ).toEqual(['Queries'])
    // Postgres: only the Postgres group.
    expect(
      filterMenuItemsByEngine(items, 'postgres').map((i) => i.title)
    ).toEqual(['Postgres'])
  })

  test('ZERO-DIFF: filtering the real config for ClickHouse is a no-op', () => {
    // Every current menu item lacks `engines`, so the ClickHouse view must equal
    // the config with the (new) Postgres-only items removed — i.e. the exact
    // pre-#2450 menu. Guards against accidentally tagging an existing item.
    const chTitles = filterMenuItemsByEngine(menuItemsConfig, 'clickhouse').map(
      (i) => i.title
    )
    const expected = menuItemsConfig
      .filter((i) => !i.engines?.includes('postgres'))
      .map((i) => i.title)
    expect(chTitles).toEqual(expected)
    // And none of the Postgres pages leak into the ClickHouse menu.
    expect(chTitles).not.toContain('Query Insights')
    expect(chTitles).not.toContain('Running Queries')
  })

  test('Postgres view surfaces the Postgres pages', () => {
    const pgTitles = filterMenuItemsByEngine(menuItemsConfig, 'postgres').map(
      (i) => i.title
    )
    expect(pgTitles).toContain('Query Insights')
    expect(pgTitles).toContain('Running Queries')
    // ClickHouse-only top-level items must not appear.
    expect(pgTitles).not.toContain('Overview')
    expect(pgTitles).not.toContain('Health')
  })
})
