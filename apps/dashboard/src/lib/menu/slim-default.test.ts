import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_HIDDEN_MENU_HREFS,
  DEFAULT_VISIBLE_MENU_HREFS,
} from '@/lib/menu/slim-default'
import {
  applyWorkspaceVisibility,
  collectMenuLeaves,
} from '@/lib/menu/workspace-presets'
import { DEFAULT_USER_SETTINGS } from '@/lib/types/user-settings'

describe('slim default sidebar (Essential keep list)', () => {
  const leaves = collectMenuLeaves(menuItemsConfig)
  const hidden = new Set(DEFAULT_HIDDEN_MENU_HREFS)
  const visible = new Set<string>(DEFAULT_VISIBLE_MENU_HREFS)

  test('every default-engine leaf is either day-to-day or on the hide list', () => {
    for (const leaf of leaves) {
      if (leaf.href.startsWith('/postgres/')) {
        expect(hidden.has(leaf.href), leaf.href).toBe(false)
        continue
      }
      expect(
        visible.has(leaf.href) || hidden.has(leaf.href),
        `${leaf.href} (${leaf.title}) must be in the keep list or the hide list`
      ).toBe(true)
      expect(
        visible.has(leaf.href) && hidden.has(leaf.href),
        `${leaf.href} cannot be both visible and hidden`
      ).toBe(false)
    }
  })

  test('QA keep list is Essential plus Insights, Explorer, and Query History', () => {
    expect([...DEFAULT_VISIBLE_MENU_HREFS]).toEqual([
      '/overview',
      '/agents',
      '/insights',
      '/health',
      '/running-queries',
      '/history-queries',
      '/tables-overview',
      '/explorer',
      '/sql',
    ])
  })

  test('day-to-day hrefs exist on the catalog', () => {
    const leafHrefs = new Set(leaves.map((leaf) => leaf.href))
    for (const href of DEFAULT_VISIBLE_MENU_HREFS) {
      expect(leafHrefs.has(href), href).toBe(true)
    }
  })

  test('footer About is never on the hide list', () => {
    expect(DEFAULT_HIDDEN_MENU_HREFS).not.toContain('/about')
  })

  test('standing settings / specialist pages are hidden', () => {
    for (const href of [
      '/alert-settings',
      '/health-settings',
      '/inbound-events',
      '/agents/settings',
      '/mcp',
      '/keeper/info',
      '/peerdb',
      '/logs/text-log',
      '/settings',
      '/backups',
    ]) {
      expect(DEFAULT_HIDDEN_MENU_HREFS, href).toContain(href)
    }
  })

  test('first-run settings apply the Essential hide list as Custom', () => {
    expect(DEFAULT_USER_SETTINGS.workspacePreset).toBe('custom')
    expect(DEFAULT_USER_SETTINGS.hiddenMenuHrefs).toEqual(
      DEFAULT_HIDDEN_MENU_HREFS
    )

    const titles = applyWorkspaceVisibility(menuItemsConfig, {
      workspacePreset: DEFAULT_USER_SETTINGS.workspacePreset,
      hiddenMenuHrefs: DEFAULT_USER_SETTINGS.hiddenMenuHrefs,
    }).map((item: MenuItem) => item.title)

    expect(titles).toContain('Overview')
    expect(titles).toContain('AI Agent')
    expect(titles).toContain('Insights')
    expect(titles).toContain('Health')
    expect(titles).toContain('Queries')
    expect(titles).toContain('Tables')
    expect(titles).toContain('Tools')
    expect(titles).toContain('About')
    expect(titles).not.toContain('Merges')
    expect(titles).not.toContain('Metrics')
    expect(titles).not.toContain('Cluster')
    expect(titles).not.toContain('Keeper')
    expect(titles).not.toContain('PeerDB')
    expect(titles).not.toContain('Security')
    expect(titles).not.toContain('Logs')
    expect(titles).not.toContain('System')
    expect(titles).not.toContain('Operations')
  })

  test('first-run grouped rail keeps the extra day-to-day children', () => {
    const visible = applyWorkspaceVisibility(menuItemsConfig, {
      workspacePreset: DEFAULT_USER_SETTINGS.workspacePreset,
      hiddenMenuHrefs: DEFAULT_USER_SETTINGS.hiddenMenuHrefs,
    })
    const childHrefs = (title: string) =>
      visible
        .find((item: MenuItem) => item.title === title)
        ?.items?.map((child) => child.href)

    expect(
      visible.find((item: MenuItem) => item.title === 'Overview')?.href
    ).toBe('/overview')
    expect(childHrefs('AI Agent')).toEqual(['/agents'])
    expect(childHrefs('Insights')).toEqual(['/insights'])
    expect(childHrefs('Health')).toEqual(['/health'])
    expect(childHrefs('Queries')).toEqual([
      '/running-queries',
      '/history-queries',
    ])
    expect(childHrefs('Tables')).toEqual(['/explorer', '/tables-overview'])
    expect(childHrefs('Tools')).toEqual(['/sql', '/explorer'])
    expect(childHrefs('Merges')).toBeUndefined()
    expect(childHrefs('Metrics')).toBeUndefined()
    expect(childHrefs('Cluster')).toBeUndefined()
  })

  test('Essential keep list excludes specialist rail rows', () => {
    for (const href of [
      '/merges',
      '/metrics',
      '/clusters',
      '/explain',
      '/advisor',
      '/alert-settings',
      '/keeper/info',
      '/peerdb',
      '/logs/text-log',
      '/settings',
      '/tables',
    ]) {
      expect(DEFAULT_VISIBLE_MENU_HREFS as readonly string[]).not.toContain(
        href
      )
      if (href !== '/tables') {
        expect(DEFAULT_HIDDEN_MENU_HREFS, href).toContain(href)
      }
    }
    for (const href of DEFAULT_VISIBLE_MENU_HREFS) {
      expect(DEFAULT_HIDDEN_MENU_HREFS).not.toContain(href)
    }
  })
})
