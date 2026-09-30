import type { MenuItem } from '@/components/menu/types'
import type { HubSection } from '@/lib/menu/hub'
import type { UnavailableVisibility } from '@/lib/menu/unavailable-visibility'

import { describe, expect, test } from 'bun:test'
import { filterHubSections } from '@/lib/menu/hub-visibility'

const item = (href: string): MenuItem => ({ title: href, href }) as MenuItem
const sections: HubSection[] = [
  { name: 'A', items: [item('/a1'), item('/a2')] },
  { name: 'B', items: [item('/b1')] },
]
const base = {
  hiddenHrefs: new Set<string>(),
  visibilityOf: (): UnavailableVisibility => 'available',
  showHidden: false,
}
const hrefs = (r: ReturnType<typeof filterHubSections>) =>
  r.sections.flatMap((s) => s.items.map((i) => i.href))

describe('filterHubSections', () => {
  test('nothing hidden leaves every card and a zero count', () => {
    const r = filterHubSections(sections, base)
    expect(hrefs(r)).toEqual(['/a1', '/a2', '/b1'])
    expect(r.hiddenCount).toBe(0)
  })

  test('a workspace-hidden href is excluded and counted', () => {
    const r = filterHubSections(sections, {
      ...base,
      hiddenHrefs: new Set(['/a2']),
    })
    expect(hrefs(r)).toEqual(['/a1', '/b1'])
    expect(r.hiddenCount).toBe(1)
  })

  test('an unavailable page the setting hides is excluded and counted', () => {
    const r = filterHubSections(sections, {
      ...base,
      visibilityOf: (i) => (i.href === '/a1' ? 'hidden' : 'available'),
    })
    expect(hrefs(r)).toEqual(['/a2', '/b1'])
    expect(r.hiddenCount).toBe(1)
  })

  test('a page hidden both ways is counted once', () => {
    const r = filterHubSections(sections, {
      ...base,
      hiddenHrefs: new Set(['/a1']),
      visibilityOf: () => 'hidden',
    })
    expect(r.hiddenCount).toBe(3)
    expect(r.sections).toEqual([])
  })

  test('a section with every card hidden is omitted until toggled on', () => {
    const input = { ...base, hiddenHrefs: new Set(['/b1']) }
    expect(
      filterHubSections(sections, input).sections.map((s) => s.name)
    ).toEqual(['A'])
    const shown = filterHubSections(sections, { ...input, showHidden: true })
    expect(shown.sections.map((s) => s.name)).toEqual(['A', 'B'])
    expect(shown.hiddenCount).toBe(1)
  })

  test('toggle includes hidden pages in place, order preserved', () => {
    const r = filterHubSections(sections, {
      ...base,
      hiddenHrefs: new Set(['/a1']),
      showHidden: true,
    })
    expect(hrefs(r)).toEqual(['/a1', '/a2', '/b1'])
  })

  test('unavailable but not hidden (dimmed) stays and is not counted', () => {
    const r = filterHubSections(sections, {
      ...base,
      visibilityOf: () => 'dimmed',
    })
    expect(hrefs(r)).toEqual(['/a1', '/a2', '/b1'])
    expect(r.hiddenCount).toBe(0)
  })
})
