import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import { DEFAULT_SOURCE_ENGINE } from '@chm/types'
import {
  filterCloudOnly,
  filterMenuItemsByEngine,
  getAllowedMenuItems,
  getSettingsNavMenuItems,
  getVisibleMenuItems,
} from '@/lib/menu/visible-items'
import {
  applyWorkspaceVisibility,
  collectMenuHrefs,
  PRESET_GROUP_TITLES,
} from '@/lib/menu/workspace-presets'

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
        items: [leaf({ title: 'Billing', href: '/billing', cloudOnly: true })],
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

// Intent guard: leftover cloud-only nav (e.g. Billing) stays hidden on OSS.
describe('menu config cloud-only contract', () => {
  test('Organization is no longer a nav item', () => {
    expect(
      menuItemsConfig.find((item) => item.href === '/organization')
    ).toBeUndefined()
  })

  test('Billing is hidden when filtering the real config in OSS', () => {
    const titles = filterCloudOnly(menuItemsConfig, false).map((i) => i.title)
    expect(titles).not.toContain('Organization')
    expect(titles).not.toContain('Billing')
  })
})

// Footer nav rows (About) render in the sidebar footer
// (AppSidebar) instead of a labelled body group, but flow through the SAME
// visibility pipeline. These guard the section wiring so the footer stays in
// sync with menu.ts.
describe('menu config footer section', () => {
  const footerTitles = (items: MenuItem[]) =>
    items.filter((i) => i.section === 'footer').map((i) => i.title)

  test('About is a top-level footer item', () => {
    const byHref = (href: string) =>
      menuItemsConfig.find((item) => item.href === href)
    expect(byHref('/billing')).toBeUndefined()
    expect(byHref('/organization')).toBeUndefined()
    expect(byHref('/about')?.section).toBe('footer')
  })

  test('About is reachable in OSS (not cloudOnly, keeps its permission)', () => {
    const about = menuItemsConfig.find((item) => item.href === '/about')
    expect(about?.cloudOnly).toBeUndefined()
    expect(about?.permission).toEqual({ feature: 'about' })
  })

  test('About is no longer nested under the Operations group', () => {
    const operations = menuItemsConfig.find(
      (item) => item.title === 'Operations'
    )
    expect(operations?.items?.some((i) => i.href === '/about')).toBe(false)
  })

  test('OSS and cloud footer both keep About only', () => {
    expect(footerTitles(filterCloudOnly(menuItemsConfig, false))).toEqual([
      'About',
    ])
    expect(footerTitles(filterCloudOnly(menuItemsConfig, true))).toEqual([
      'About',
    ])
  })
})

// Engine-aware menu swap (issue #2450, decision 4). The HARD invariant: for the
// ClickHouse family the menu is byte-for-byte today's menu; for Postgres only
// the Postgres-tagged items show.
describe('filterMenuItemsByEngine', () => {
  test('absent `engines` = ClickHouse family only', () => {
    const items = [
      leaf({ title: 'Overview', href: '/overview' }),
      leaf({ title: 'PG', href: '/postgres/queries', engines: ['postgres'] }),
    ]
    expect(
      filterMenuItemsByEngine(items, 'clickhouse').map((i) => i.title)
    ).toEqual(['Overview'])
    expect(
      filterMenuItemsByEngine(items, 'clickhouse-cloud').map((i) => i.title)
    ).toEqual(['Overview'])
    expect(
      filterMenuItemsByEngine(items, 'postgres').map((i) => i.title)
    ).toEqual(['PG'])
  })

  test('drops a parent group left empty for the engine', () => {
    const items: MenuItem[] = [
      {
        title: 'Queries',
        href: '',
        items: [leaf({ title: 'Running', href: '/running-queries' })],
      },
      {
        title: 'Postgres',
        href: '',
        engines: ['postgres'],
        items: [
          leaf({
            title: 'PG Queries',
            href: '/postgres/queries',
            engines: ['postgres'],
          }),
        ],
      },
    ]
    // ClickHouse: CH group kept, Postgres group dropped entirely.
    expect(
      filterMenuItemsByEngine(items, 'clickhouse').map((i) => i.title)
    ).toEqual(['Queries'])
    // Postgres: only the Postgres group.
    expect(
      filterMenuItemsByEngine(items, 'postgres').map((i) => i.title)
    ).toEqual(['Postgres'])
  })

  test('ZERO-DIFF: filtering the real config for ClickHouse is a no-op', () => {
    // The ClickHouse view must equal the config with the Postgres-ONLY items
    // removed — i.e. the exact pre-#2450 menu. Items tagged with every engine
    // (the footer rows) still count as ClickHouse items. Guards against
    // accidentally hiding an existing item from the ClickHouse menu.
    const chTitles = filterMenuItemsByEngine(menuItemsConfig, 'clickhouse').map(
      (i) => i.title
    )
    const expected = menuItemsConfig
      .filter((i) => !i.engines || i.engines.includes('clickhouse'))
      .map((i) => i.title)
    expect(chTitles).toEqual(expected)
    // And none of the Postgres pages leak into the ClickHouse menu.
    expect(chTitles).not.toContain('Query Insights')
    expect(chTitles).not.toContain('Running Queries')
  })

  test('Postgres view surfaces the Postgres pages', () => {
    const pgTitles = filterMenuItemsByEngine(menuItemsConfig, 'postgres').map(
      (i) => i.title
    )
    expect(pgTitles).toContain('Query Insights')
    expect(pgTitles).toContain('Running Queries')
    // Account-level footer rows are engine-independent and stay visible.
    expect(pgTitles).toContain('About')
    expect(pgTitles).not.toContain('Billing')
    // ClickHouse-only top-level items must not appear.
    expect(pgTitles).not.toContain('Overview')
    expect(pgTitles).not.toContain('Health')
    // #3134: nested under Health (default source-engine family); do not leak as a
    // stray top-level item on Postgres hosts.
    expect(pgTitles).not.toContain('Inbound Events')
    // #3115: the whole Tools group is hidden, not an empty parent.
    expect(pgTitles).not.toContain('Tools')
  })

  test('Postgres host does not see the Tools group at all (#3115)', () => {
    // Absent `engines` on the Tools parent fails itemMatchesEngine for
    // postgres, so the group is dropped before children are considered.
    const pg = filterMenuItemsByEngine(menuItemsConfig, 'postgres')
    expect(pg.map((i) => i.title)).not.toContain('Tools')
    for (const href of [
      '/sql',
      '/explorer',
      '/explain',
      '/advisor',
      '/dashboard',
      '/schema-diff',
      '/settings-diff',
    ]) {
      expect(collectMenuHrefs(pg)).not.toContain(href)
    }
  })
})

describe('getSettingsNavMenuItems', () => {
  test('defaults to the Queries/Cluster tree (no Postgres pages, no footer)', () => {
    const titles = getSettingsNavMenuItems().map((i) => i.title)
    expect(titles).toEqual(
      getSettingsNavMenuItems(DEFAULT_SOURCE_ENGINE).map((i) => i.title)
    )
    expect(titles).toContain('Queries')
    expect(titles).toContain('Tools')
    expect(titles).toContain('Cluster')
    expect(titles).not.toContain('Query Insights')
    expect(titles).not.toContain('About')
  })

  test('Tools is after Logs and before System in the Settings tree (#3117)', () => {
    const titles = getSettingsNavMenuItems().map((i) => i.title)
    const toolsAt = titles.indexOf('Tools')
    expect(toolsAt).toBeGreaterThan(titles.indexOf('Logs'))
    expect(toolsAt).toBeLessThan(titles.indexOf('System'))
    expect(toolsAt).toBeLessThan(titles.indexOf('Cluster'))
    expect(toolsAt).toBeGreaterThan(titles.indexOf('AI Agent'))
  })

  test('Postgres engine yields the Postgres menu tree, not Queries/Cluster groups', () => {
    const titles = getSettingsNavMenuItems('postgres').map((i) => i.title)
    expect(titles).toContain('Query Insights')
    expect(titles).toContain('Running Queries')
    expect(titles).not.toContain('Queries')
    expect(titles).not.toContain('Tools')
    expect(titles).not.toContain('Cluster')
    expect(titles).not.toContain('Overview')
    expect(titles).not.toContain('About')
  })

  test('Postgres Settings tree does not include Tools leaves (#3105)', () => {
    const hrefs = collectMenuHrefs(getSettingsNavMenuItems('postgres'))
    for (const href of [
      '/sql',
      '/explorer',
      '/explain',
      '/advisor',
      '/dashboard',
      '/schema-diff',
      '/settings-diff',
    ]) {
      expect(hrefs).not.toContain(href)
    }
  })
})

describe('applyWorkspaceVisibility', () => {
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
      title: 'Keeper',
      href: '',
      items: [leaf({ title: 'Keeper Info', href: '/keeper/info' })],
    },
    {
      title: 'Health',
      href: '',
      items: [leaf({ title: 'Health', href: '/health' })],
    },
    leaf({ title: 'About', href: '/about', section: 'footer' }),
  ]

  test('Full keeps every item and applies an extra hide list', () => {
    const full = applyWorkspaceVisibility(fixture, {
      workspacePreset: 'full',
      hiddenMenuHrefs: [],
    })
    expect(full.map((i) => i.title)).toEqual([
      'Overview',
      'Queries',
      'Keeper',
      'Health',
      'About',
    ])

    const hidden = applyWorkspaceVisibility(fixture, {
      workspacePreset: 'full',
      hiddenMenuHrefs: ['/advisor'],
    })
    expect(
      hidden.find((i) => i.title === 'Queries')?.items?.map((i) => i.href)
    ).toEqual(['/running-queries'])
  })

  test('named presets keep a stable group set and never drop the footer', () => {
    const dba = applyWorkspaceVisibility(fixture, {
      workspacePreset: 'dba',
      hiddenMenuHrefs: [],
    })
    expect(dba.map((i) => i.title)).toEqual([
      'Overview',
      'Queries',
      'Keeper',
      'About',
    ])

    const engineer = applyWorkspaceVisibility(fixture, {
      workspacePreset: 'engineer',
      hiddenMenuHrefs: [],
    })
    expect(engineer.map((i) => i.title)).toEqual([
      'Overview',
      'Queries',
      'About',
    ])

    const sre = applyWorkspaceVisibility(fixture, {
      workspacePreset: 'sre',
      hiddenMenuHrefs: [],
    })
    expect(sre.map((i) => i.title)).toEqual([
      'Overview',
      'Queries',
      'Health',
      'About',
    ])
  })

  test('custom hide-list drops a parent left empty', () => {
    const result = applyWorkspaceVisibility(fixture, {
      workspacePreset: 'custom',
      hiddenMenuHrefs: ['/keeper/info'],
    })
    expect(result.map((i) => i.title)).not.toContain('Keeper')
    expect(result.map((i) => i.title)).toContain('About')
  })

  test('new fixture groups stay hidden on a named preset and appear on Full', () => {
    const withNewGroup: MenuItem[] = [
      ...fixture,
      {
        title: 'Brand New',
        href: '',
        items: [leaf({ title: 'TTL', href: '/ttl' })],
      },
    ]
    const dba = applyWorkspaceVisibility(withNewGroup, {
      workspacePreset: 'dba',
      hiddenMenuHrefs: [],
    })
    expect(dba.map((i) => i.title)).not.toContain('Brand New')

    const full = applyWorkspaceVisibility(withNewGroup, {
      workspacePreset: 'full',
      hiddenMenuHrefs: [],
    })
    expect(full.map((i) => i.title)).toContain('Brand New')
  })

  test('DBA preset group titles stay the documented set', () => {
    expect(PRESET_GROUP_TITLES.dba).toContain('Tables')
    expect(PRESET_GROUP_TITLES.dba).toContain('Tools')
    expect(PRESET_GROUP_TITLES.engineer).toContain('Tools')
    expect(PRESET_GROUP_TITLES.engineer).not.toContain('Keeper')
    expect(PRESET_GROUP_TITLES.sre).toContain('Health')
    expect(PRESET_GROUP_TITLES.sre).toContain('Tools')
  })
})

describe('palette includes hidden pages', () => {
  const config = {
    authProvider: 'none' as const,
    principal: 'anonymous' as const,
    features: {},
  }

  test('getAllowedMenuItems keeps specialist hrefs that workspace hide drops', () => {
    const allowed = collectMenuHrefs(getAllowedMenuItems(config))
    const sidebar = collectMenuHrefs(
      getVisibleMenuItems(config, DEFAULT_SOURCE_ENGINE, {
        workspacePreset: 'custom',
        hiddenMenuHrefs: [
          '/history-queries',
          '/slow-queries',
          '/insights',
          '/explorer',
        ],
      })
    )

    expect(allowed).toContain('/history-queries')
    expect(allowed).toContain('/slow-queries')
    expect(allowed).toContain('/insights')
    expect(sidebar).not.toContain('/history-queries')
    expect(sidebar).not.toContain('/slow-queries')
    expect(sidebar).not.toContain('/insights')
  })
})
