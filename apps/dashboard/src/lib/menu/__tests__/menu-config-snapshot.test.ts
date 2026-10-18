import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'

interface FlatEntry {
  depth: number
  title: string
  href: string
  section?: string
  subgroup?: string
}

function flatten(
  items: MenuItem[],
  depth = 0,
  out: FlatEntry[] = []
): FlatEntry[] {
  for (const item of items) {
    out.push({
      depth,
      title: item.title,
      href: item.href,
      section: item.section,
      subgroup: item.subgroup,
    })
    if (item.items) flatten(item.items, depth + 1, out)
  }
  return out
}

describe('menuItemsConfig snapshot', () => {
  test('flattened menu structure (titles, hrefs, order, nesting) is unchanged', () => {
    expect(flatten(menuItemsConfig)).toMatchSnapshot()
  })
})
