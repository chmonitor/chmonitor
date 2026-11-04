import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import { buildGroupPageIndex } from '@/lib/menu/group-page-index'

const page = (href: string): MenuItem => ({ title: href, href }) as MenuItem
const children = [page('/a'), page('/b'), page('/c'), page('/d'), page('/e')]
const hrefs = (entries: ReturnType<typeof buildGroupPageIndex>) =>
  entries.map((e) => e.item.href)

describe('buildGroupPageIndex', () => {
  test('lists pages hidden from the sidebar instead of dropping them', () => {
    const entries = buildGroupPageIndex(children, [], new Set(['/b', '/d']))
    expect(hrefs(entries)).toEqual(['/a', '/c', '/e', '/b', '/d'])
    expect(entries.map((e) => e.inSidebar)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
  })

  test('pinned pages lead in pin order, not declaration order', () => {
    const entries = buildGroupPageIndex(children, ['/e', '/c'], new Set())
    expect(hrefs(entries)).toEqual(['/e', '/c', '/a', '/b', '/d'])
    expect(entries.map((e) => e.pinned)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
  })

  test('a pinned page that is hidden from the sidebar still leads', () => {
    const entries = buildGroupPageIndex(children, ['/d'], new Set(['/d']))
    expect(entries[0]).toEqual({
      item: children[3],
      pinned: true,
      inSidebar: false,
    })
  })

  test('pins from other groups and href-less children are ignored', () => {
    const entries = buildGroupPageIndex(
      [page('/a'), { title: 'Heading', href: '' } as MenuItem, page('/b')],
      ['/elsewhere', '/b'],
      new Set()
    )
    expect(hrefs(entries)).toEqual(['/b', '/a'])
  })
})
