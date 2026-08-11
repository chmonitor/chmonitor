/**
 * Regression test for the menu/<section>.ts split (issue #2897). `menu.ts`
 * used to be one 1040-line array literal; it is now composed from
 * `menu/<section>.ts` files via `menu/index.ts`. This test captures the
 * flattened, in-order shape of `menuItemsConfig` — hrefs, titles, section,
 * and nesting depth — so a future split/reorg cannot silently change what
 * the sidebar or command palette render. Written against the pre-split
 * monolith to prove the split is byte-for-byte equivalent, then kept as a
 * standing regression guard.
 */

import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'

interface FlatEntry {
  depth: number
  title: string
  href: string
  section?: string
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
