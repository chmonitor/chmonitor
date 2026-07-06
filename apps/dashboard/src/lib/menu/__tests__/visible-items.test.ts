import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import { filterCloudOnly } from '@/lib/menu/visible-items'

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
