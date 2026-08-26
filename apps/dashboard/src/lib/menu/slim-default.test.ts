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

describe('slim default sidebar (#3290)', () => {
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

  test('day-to-day hrefs exist on the catalog', () => {
    const leafHrefs = new Set(leaves.map((leaf) => leaf.href))
    for (const href of DEFAULT_VISIBLE_MENU_HREFS) {
      if (href === '/tables') {
        expect(menuItemsConfig.some((item) => item.href === '/tables')).toBe(
          true
        )
        continue
      }
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

  test('first-run settings apply the slim hide list as Custom', () => {
    expect(DEFAULT_USER_SETTINGS.workspacePreset).toBe('custom')
    expect(DEFAULT_USER_SETTINGS.hiddenMenuHrefs).toEqual(
      DEFAULT_HIDDEN_MENU_HREFS
    )

    const titles = applyWorkspaceVisibility(menuItemsConfig, {
      workspacePreset: DEFAULT_USER_SETTINGS.workspacePreset,
      hiddenMenuHrefs: DEFAULT_USER_SETTINGS.hiddenMenuHrefs,
    }).map((item: MenuItem) => item.title)

    expect(titles).toContain('Overview')
    expect(titles).toContain('Health')
    expect(titles).toContain('Queries')
    expect(titles).toContain('Tables')
    expect(titles).toContain('Tools')
    expect(titles).toContain('Cluster')
    expect(titles).toContain('About')
    expect(titles).not.toContain('Keeper')
    expect(titles).not.toContain('PeerDB')
    expect(titles).not.toContain('Security')
    expect(titles).not.toContain('Logs')
    expect(titles).not.toContain('System')
    expect(titles).not.toContain('Operations')
  })
})
