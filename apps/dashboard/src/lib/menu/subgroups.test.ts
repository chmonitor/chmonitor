/**
 * groupChildrenBySubgroup decides which headings the sidebar, the collapsed
 * flyout, the customize dialog, Settings > Navigation and ⌘K show (#3676).
 * Every page must come out exactly once, in order, whatever the grouping.
 */

import type { MenuItem } from '@/components/menu/types'

import {
  FLAT_GROUP_MAX_PAGES,
  groupChildrenBySubgroup,
  subgroupKey,
} from './subgroups'
import { describe, expect, test } from 'bun:test'

const page = (href: string, subgroup?: string): MenuItem => ({
  title: href.slice(1),
  href,
  subgroup,
})

const shape = (items: MenuItem[]) =>
  groupChildrenBySubgroup(items).map((s) => ({
    subgroup: s.subgroup,
    hrefs: s.items.map((i) => i.href),
  }))

describe('groupChildrenBySubgroup', () => {
  test('no pages -> no sections', () => {
    expect(groupChildrenBySubgroup([])).toEqual([])
  })

  test(`a group of ${FLAT_GROUP_MAX_PAGES} pages or fewer stays flat`, () => {
    const items = [
      page('/a', 'X'),
      page('/b', 'X'),
      page('/c', 'Y'),
      page('/d', 'Y'),
    ]
    expect(shape(items)).toEqual([
      { subgroup: undefined, hrefs: ['/a', '/b', '/c', '/d'] },
    ])
  })

  test('subgroups with 2+ pages get a heading, in first-appearance order', () => {
    const items = [
      page('/a', 'Live'),
      page('/b', 'Live'),
      page('/c', 'History'),
      page('/d', 'History'),
      page('/e', 'History'),
      page('/f', 'Perf'),
      page('/g', 'Perf'),
    ]
    expect(shape(items)).toEqual([
      { subgroup: 'Live', hrefs: ['/a', '/b'] },
      { subgroup: 'History', hrefs: ['/c', '/d', '/e'] },
      { subgroup: 'Perf', hrefs: ['/f', '/g'] },
    ])
  })

  test('a single-page subgroup becomes a plain row, merged with neighbouring plain rows', () => {
    const items = [
      page('/a', 'Live'),
      page('/b', 'Live'),
      page('/c', 'Solo'),
      page('/d'),
      page('/e', 'Perf'),
      page('/f', 'Perf'),
      page('/g', 'Perf'),
    ]
    expect(shape(items)).toEqual([
      { subgroup: 'Live', hrefs: ['/a', '/b'] },
      { subgroup: undefined, hrefs: ['/c', '/d'] },
      { subgroup: 'Perf', hrefs: ['/e', '/f', '/g'] },
    ])
  })

  test('a page with no subgroup renders directly under the group', () => {
    const items = [
      page('/top'),
      ...['/a', '/b', '/c'].map((h) => page(h, 'X')),
      ...['/d', '/e', '/f'].map((h) => page(h, 'Y')),
    ]
    expect(shape(items)[0]).toEqual({ subgroup: undefined, hrefs: ['/top'] })
  })

  test('every input page appears exactly once', () => {
    const items = [
      page('/a', 'X'),
      page('/b'),
      page('/c', 'Y'),
      page('/d', 'X'),
      page('/e', 'Z'),
      page('/f', 'Y'),
      page('/g'),
      page('/h', 'X'),
    ]
    const out = groupChildrenBySubgroup(items).flatMap((s) =>
      s.items.map((i) => i.href)
    )
    expect([...out].sort()).toEqual(items.map((i) => i.href).sort())
  })
})

describe('subgroupKey', () => {
  test('is "<group>/<subgroup>"', () => {
    expect(subgroupKey('Queries', 'Live')).toBe('Queries/Live')
  })
})
