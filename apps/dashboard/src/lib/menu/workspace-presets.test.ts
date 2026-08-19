import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import {
  applyWorkspacePreset,
  effectiveHiddenMenuHrefs,
  hideMenuHref,
  menuItemIsHidden,
  PRESET_GROUP_TITLES,
  showMenuHref,
} from '@/lib/menu/workspace-presets'

const leaf = (overrides: Partial<MenuItem> = {}): MenuItem => ({
  title: overrides.title ?? 'Item',
  href: overrides.href ?? '/item',
  ...overrides,
})

const fixture: MenuItem[] = [
  leaf({ title: 'Overview', href: '/overview' }),
  {
    title: 'Queries',
    href: '',
    items: [
      leaf({ title: 'Running', href: '/running-queries' }),
      leaf({ title: 'Advisor', href: '/advisor' }),
    ],
  },
  {
    title: 'Tables',
    href: '/tables',
    items: [leaf({ title: 'Tables Overview', href: '/tables-overview' })],
  },
  {
    title: 'Merges',
    href: '/merges',
    items: [leaf({ title: 'Merges', href: '/merges' })],
  },
  {
    title: 'Keeper',
    href: '',
    items: [leaf({ title: 'Keeper Info', href: '/keeper/info' })],
  },
  {
    title: 'Health',
    href: '',
    items: [leaf({ title: 'Health', href: '/health' })],
  },
  {
    title: 'Insights',
    href: '',
    items: [leaf({ title: 'Insights', href: '/insights' })],
  },
  leaf({ title: 'About', href: '/about', section: 'footer' }),
]

describe('applyWorkspacePreset', () => {
  test('Full clears the hide list', () => {
    expect(
      applyWorkspacePreset(
        fixture,
        { workspacePreset: 'custom', hiddenMenuHrefs: ['/advisor'] },
        'full'
      )
    ).toEqual({ workspacePreset: 'full', hiddenMenuHrefs: [] })
  })

  test('named preset clears the hide list', () => {
    expect(
      applyWorkspacePreset(
        fixture,
        { workspacePreset: 'custom', hiddenMenuHrefs: ['/advisor'] },
        'dba'
      )
    ).toEqual({ workspacePreset: 'dba', hiddenMenuHrefs: [] })
  })

  test('Custom from a named preset materializes pages outside that preset', () => {
    const next = applyWorkspacePreset(
      fixture,
      { workspacePreset: 'dba', hiddenMenuHrefs: [] },
      'custom'
    )
    expect(next.workspacePreset).toBe('custom')
    expect(next.hiddenMenuHrefs).toContain('/health')
    expect(next.hiddenMenuHrefs).toContain('/insights')
    expect(next.hiddenMenuHrefs).not.toContain('/overview')
    expect(next.hiddenMenuHrefs).not.toContain('/keeper/info')
    expect(next.hiddenMenuHrefs).not.toContain('/about')
  })

  test('Custom from Full keeps the current hide list', () => {
    expect(
      applyWorkspacePreset(
        fixture,
        { workspacePreset: 'full', hiddenMenuHrefs: ['/advisor'] },
        'custom'
      )
    ).toEqual({ workspacePreset: 'custom', hiddenMenuHrefs: ['/advisor'] })
  })
})

describe('hideMenuHref / showMenuHref', () => {
  test('hiding a Full leaf switches to Custom and records the href', () => {
    expect(
      hideMenuHref(
        fixture,
        { workspacePreset: 'full', hiddenMenuHrefs: [] },
        '/advisor'
      )
    ).toEqual({
      workspacePreset: 'custom',
      hiddenMenuHrefs: ['/advisor'],
    })
  })

  test('hiding a DBA leaf switches to Custom with preset-excluded pages plus that leaf', () => {
    const next = hideMenuHref(
      fixture,
      { workspacePreset: 'dba', hiddenMenuHrefs: [] },
      '/advisor'
    )
    expect(next.workspacePreset).toBe('custom')
    expect(next.hiddenMenuHrefs).toContain('/advisor')
    expect(next.hiddenMenuHrefs).toContain('/health')
    expect(next.hiddenMenuHrefs).not.toContain('/overview')
  })

  test('showing a custom-hidden leaf keeps Custom and drops that href', () => {
    expect(
      showMenuHref(
        fixture,
        { workspacePreset: 'custom', hiddenMenuHrefs: ['/advisor', '/health'] },
        '/advisor'
      )
    ).toEqual({
      workspacePreset: 'custom',
      hiddenMenuHrefs: ['/health'],
    })
  })

  test('showing a DBA-excluded leaf materializes Custom without that href', () => {
    const next = showMenuHref(
      fixture,
      { workspacePreset: 'dba', hiddenMenuHrefs: [] },
      '/health'
    )
    expect(next.workspacePreset).toBe('custom')
    expect(next.hiddenMenuHrefs).not.toContain('/health')
    expect(next.hiddenMenuHrefs).toContain('/insights')
  })

  test('hiding a parent folder href does not switch to Custom', () => {
    expect(
      hideMenuHref(
        fixture,
        { workspacePreset: 'full', hiddenMenuHrefs: [] },
        '/tables'
      )
    ).toEqual({ workspacePreset: 'full', hiddenMenuHrefs: [] })
  })

  test('showing a parent folder href does not switch to Custom', () => {
    expect(
      showMenuHref(
        fixture,
        { workspacePreset: 'dba', hiddenMenuHrefs: [] },
        '/tables'
      )
    ).toEqual({ workspacePreset: 'dba', hiddenMenuHrefs: [] })
  })

  test('hiding a leaf that is already muted by the role stays on that role', () => {
    expect(
      hideMenuHref(
        fixture,
        { workspacePreset: 'dba', hiddenMenuHrefs: [] },
        '/health'
      )
    ).toEqual({ workspacePreset: 'dba', hiddenMenuHrefs: [] })
  })

  test('showing a visible Full leaf is a no-op', () => {
    expect(
      showMenuHref(
        fixture,
        { workspacePreset: 'full', hiddenMenuHrefs: [] },
        '/overview'
      )
    ).toEqual({ workspacePreset: 'full', hiddenMenuHrefs: [] })
  })

  test('hiding a leaf that shares a parent href still switches to Custom', () => {
    expect(
      hideMenuHref(
        fixture,
        { workspacePreset: 'full', hiddenMenuHrefs: [] },
        '/merges'
      )
    ).toEqual({
      workspacePreset: 'custom',
      hiddenMenuHrefs: ['/merges'],
    })
  })
})

describe('effectiveHiddenMenuHrefs / menuItemIsHidden', () => {
  test('named presets mute leaves outside the group set', () => {
    const hidden = new Set(
      effectiveHiddenMenuHrefs(fixture, {
        workspacePreset: 'engineer',
        hiddenMenuHrefs: [],
      })
    )
    expect(hidden.has('/keeper/info')).toBe(true)
    expect(hidden.has('/health')).toBe(true)
    expect(hidden.has('/overview')).toBe(false)
    expect(hidden.has('/running-queries')).toBe(false)
  })

  test('a parent is hidden only when every child leaf is hidden', () => {
    const hidden = new Set(['/advisor'])
    expect(
      menuItemIsHidden(
        fixture.find((item) => item.title === 'Queries') as MenuItem,
        hidden
      )
    ).toBe(false)
    expect(
      menuItemIsHidden(
        fixture.find((item) => item.title === 'Queries') as MenuItem,
        new Set(['/advisor', '/running-queries'])
      )
    ).toBe(true)
  })
})

describe('PRESET_GROUP_TITLES', () => {
  test('DBA, Engineer, and SRE all include Tools', () => {
    expect(PRESET_GROUP_TITLES.dba).toContain('Tools')
    expect(PRESET_GROUP_TITLES.engineer).toContain('Tools')
    expect(PRESET_GROUP_TITLES.sre).toContain('Tools')
  })
})
