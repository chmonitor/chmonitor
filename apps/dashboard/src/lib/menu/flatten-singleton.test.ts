import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SOURCE_ENGINE } from '@chm/types'
import {
  flattenSingletonGroups,
  flattenSingletonTitle,
} from '@/lib/menu/flatten-singleton'
import { revealAlertsWhenActive } from '@/lib/menu/notification-alerts'
import { DEFAULT_HIDDEN_MENU_HREFS } from '@/lib/menu/slim-default'
import { filterMenuItemsByEngine } from '@/lib/menu/visible-items'
import { applyWorkspaceVisibility } from '@/lib/menu/workspace-presets'

const leaf = (overrides: Partial<MenuItem> = {}): MenuItem => ({
  title: overrides.title ?? 'Item',
  href: overrides.href ?? '/item',
  ...overrides,
})

function essentialRail(): MenuItem[] {
  return applyWorkspaceVisibility(
    filterMenuItemsByEngine(menuItemsConfig, DEFAULT_SOURCE_ENGINE),
    {
      workspacePreset: 'custom',
      hiddenMenuHrefs: DEFAULT_HIDDEN_MENU_HREFS,
    }
  )
}

describe('flattenSingletonTitle', () => {
  test('uses the parent title for Queries / Tables / Health', () => {
    expect(
      flattenSingletonTitle(
        leaf({ title: 'Queries', href: '' }),
        leaf({ title: 'Running Queries', href: '/running-queries' })
      )
    ).toBe('Queries')
    expect(
      flattenSingletonTitle(
        leaf({ title: 'Tables', href: '/tables' }),
        leaf({ title: 'Tables Overview', href: '/tables-overview' })
      )
    ).toBe('Tables')
    expect(
      flattenSingletonTitle(
        leaf({ title: 'Health', href: '' }),
        leaf({ title: 'Health', href: '/health' })
      )
    ).toBe('Health')
  })

  test('uses Chat / SQL for folder groups', () => {
    expect(
      flattenSingletonTitle(
        leaf({ title: 'AI Agent', href: '' }),
        leaf({ title: 'Chat', href: '/agents' })
      )
    ).toBe('Chat')
    expect(
      flattenSingletonTitle(
        leaf({ title: 'Tools', href: '' }),
        leaf({ title: 'SQL Console', href: '/sql' })
      )
    ).toBe('SQL')
  })
})

describe('flattenSingletonGroups', () => {
  test('hoists a single visible child and drops the chevron', () => {
    const items: MenuItem[] = [
      leaf({ title: 'Overview', href: '/overview', section: 'main' }),
      {
        title: 'Queries',
        href: '',
        section: 'main',
        items: [leaf({ title: 'Running Queries', href: '/running-queries' })],
      },
      {
        title: 'Queries Many',
        href: '',
        section: 'main',
        items: [
          leaf({ title: 'Running', href: '/running-queries' }),
          leaf({ title: 'History', href: '/history-queries' }),
        ],
      },
    ]

    const flat = flattenSingletonGroups(items)
    expect(flat[0]?.items).toBeUndefined()
    expect(flat[1]?.title).toBe('Queries')
    expect(flat[1]?.href).toBe('/running-queries')
    expect(flat[1]?.items).toBeUndefined()
    expect(flat[2]?.title).toBe('Queries Many')
    expect(flat[2]?.items).toHaveLength(2)
  })
})

describe('Essential first-run rail (grouped, not flattened)', () => {
  test('live sidebar source does not flatten singleton groups', () => {
    const src = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'use-visible-menu-items.ts'
      ),
      'utf8'
    )
    expect(src).not.toMatch(/\bflattenSingletonGroups\b/)
    expect(src).toContain('revealAlertsWhenActive')
  })

  test('keeps parent groups with one visible child plus About', () => {
    const visible = essentialRail()
    const body = visible.filter((item) => item.section !== 'footer')

    expect(body.map((item) => item.title)).toEqual([
      'Overview',
      'AI Agent',
      'Health',
      'Queries',
      'Tables',
      'Tools',
    ])
    expect(body[0]?.href).toBe('/overview')
    expect(body[0]?.items).toBeUndefined()
    expect(body.map((item) => item.items?.map((child) => child.href))).toEqual([
      undefined,
      ['/agents'],
      ['/health'],
      ['/running-queries'],
      ['/tables-overview'],
      ['/sql'],
    ])
    expect(body.map((item) => item.items?.map((child) => child.title))).toEqual(
      [
        undefined,
        ['Chat'],
        ['Health'],
        ['Running Queries'],
        ['Tables Overview'],
        ['SQL Console'],
      ]
    )
    expect(visible.some((item) => item.href === '/about')).toBe(true)
  })

  test('Alerts injection keeps Health as a two-child group', () => {
    const withAlerts = revealAlertsWhenActive(essentialRail(), true)
    const health = withAlerts.find((item) => item.title === 'Health')
    expect(health?.items?.map((child) => child.href)).toEqual([
      '/health',
      '/alert-settings',
    ])
    expect(
      withAlerts
        .find((item) => item.title === 'Queries')
        ?.items?.map((child) => child.href)
    ).toEqual(['/running-queries'])
  })
})
