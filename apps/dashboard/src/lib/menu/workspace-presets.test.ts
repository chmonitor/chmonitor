import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import {
  applyWorkspacePreset,
  applyWorkspaceVisibility,
  collectMenuHrefs,
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
    title: 'Cluster & Replication',
    href: '',
    items: [leaf({ title: 'Keeper Info', href: '/keeper/info' })],
  },
  {
    title: 'Alerts & Insights',
    href: '',
    items: [
      leaf({ title: 'Health', href: '/health' }),
      leaf({ title: 'Insights', href: '/insights' }),
    ],
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

  test('hiding a leaf already in the preset hide list stays on that role', () => {
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
})

describe('hideMenuHref with real menu config (#3134)', () => {
  test('hiding nested /inbound-events still records the leaf href', () => {
    const next = hideMenuHref(
      menuItemsConfig,
      { workspacePreset: 'full', hiddenMenuHrefs: [] },
      '/inbound-events'
    )
    expect(next.workspacePreset).toBe('custom')
    expect(next.hiddenMenuHrefs).toEqual(['/inbound-events'])
  })

  test('showing nested /inbound-events drops that href', () => {
    const next = showMenuHref(
      menuItemsConfig,
      { workspacePreset: 'custom', hiddenMenuHrefs: ['/inbound-events'] },
      '/inbound-events'
    )
    expect(next.hiddenMenuHrefs).not.toContain('/inbound-events')
  })

  test('hiding the leaf keeps the Alerts & Insights group and its other children', () => {
    const visible = applyWorkspaceVisibility(menuItemsConfig, {
      workspacePreset: 'custom',
      hiddenMenuHrefs: ['/inbound-events'],
    })
    const alerts = visible.find((item) => item.title === 'Alerts & Insights')
    expect(alerts?.items?.map((item) => item.href)).toEqual([
      '/insights',
      '/health',
      '/traffic',
    ])
  })
})

describe('effectiveHiddenMenuHrefs / menuItemIsHidden', () => {
  test('named presets mute leaves outside the group set', () => {
    const hidden = new Set(
      effectiveHiddenMenuHrefs(fixture, {
        workspacePreset: 'dba',
        hiddenMenuHrefs: [],
      })
    )
    expect(hidden.has('/keeper/info')).toBe(false)
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

// Every page each named preset showed under the old 16-group layout
// (captured before #3565). Group-title presets are coarse, so a preset may
// now show MORE pages, but never fewer: a DBA who picked "DBA" must not lose
// a page because it moved to another group.
const PRE_3565_PRESET_HREFS: Record<'dba' | 'engineer' | 'sre', string[]> = {
  dba: [
    '/overview',
    '/running-queries',
    '/history-queries',
    '/queries/insights',
    '/recent-queries',
    '/failed-queries',
    '/expensive-queries',
    '/slow-queries',
    '/slow-query-patterns',
    '/query-views-log',
    '/queries/thread-analysis',
    '/user-processes',
    '/query-metric-log',
    '/query-cache',
    '/query-condition-cache',
    '/explorer',
    '/tables-overview',
    '/ttl-partition-health',
    '/distributed-ddl-queue',
    '/replicas',
    '/replication-queue',
    '/replicated-fetches',
    '/readonly-tables',
    '/dropped-tables',
    '/dictionaries',
    '/kafka-consumers',
    '/rabbitmq-consumers',
    '/asynchronous-inserts',
    '/detached-parts',
    '/view-refreshes',
    '/index-analytics',
    '/merges',
    '/merge-performance',
    '/mutations',
    '/moves',
    '/part-log',
    '/metrics',
    '/asynchronous-metrics',
    '/profiler',
    '/keeper/overview',
    '/keeper?path=/',
    '/keeper/info',
    '/keeper/connections',
    '/keeper/connection-log',
    '/keeper/log',
    '/keeper/watches',
    '/keeper/deep-dive',
    '/security/sessions',
    '/security/login-attempts',
    '/security/audit-log',
    '/users',
    '/roles',
    '/security/management',
    '/logs/text-log',
    '/logs/stack-traces',
    '/logs/crashes',
    '/opentelemetry-spans',
    '/sql',
    '/explain',
    '/advisor',
    '/dashboard',
    '/schema-diff',
    '/settings-diff',
    '/settings',
    '/mergetree-settings',
    '/replicated-merge-tree-settings',
    '/disks',
    '/storage-economics',
    '/warnings',
    '/background-schedule-pool',
    '/histogram-metrics',
    '/workload-scheduling',
    '/clusters',
    '/fleet',
    '/charts?name=connections-http,connections-interserver',
  ],
  engineer: [
    '/overview',
    '/agents',
    '/agents/settings',
    '/mcp',
    '/insights',
    '/traffic',
    '/insights-settings',
    '/report-settings',
    '/running-queries',
    '/history-queries',
    '/queries/insights',
    '/recent-queries',
    '/failed-queries',
    '/expensive-queries',
    '/slow-queries',
    '/slow-query-patterns',
    '/query-views-log',
    '/queries/thread-analysis',
    '/user-processes',
    '/query-metric-log',
    '/query-cache',
    '/query-condition-cache',
    '/explorer',
    '/tables-overview',
    '/ttl-partition-health',
    '/distributed-ddl-queue',
    '/replicas',
    '/replication-queue',
    '/replicated-fetches',
    '/readonly-tables',
    '/dropped-tables',
    '/dictionaries',
    '/kafka-consumers',
    '/rabbitmq-consumers',
    '/asynchronous-inserts',
    '/detached-parts',
    '/view-refreshes',
    '/index-analytics',
    '/sql',
    '/explain',
    '/advisor',
    '/dashboard',
    '/schema-diff',
    '/settings-diff',
  ],
  sre: [
    '/overview',
    '/insights',
    '/traffic',
    '/insights-settings',
    '/report-settings',
    '/health',
    '/health-settings',
    '/alert-settings',
    '/inbound-events',
    '/running-queries',
    '/history-queries',
    '/queries/insights',
    '/recent-queries',
    '/failed-queries',
    '/expensive-queries',
    '/slow-queries',
    '/slow-query-patterns',
    '/query-views-log',
    '/queries/thread-analysis',
    '/user-processes',
    '/query-metric-log',
    '/query-cache',
    '/query-condition-cache',
    '/explorer',
    '/tables-overview',
    '/ttl-partition-health',
    '/distributed-ddl-queue',
    '/replicas',
    '/replication-queue',
    '/replicated-fetches',
    '/readonly-tables',
    '/dropped-tables',
    '/dictionaries',
    '/kafka-consumers',
    '/rabbitmq-consumers',
    '/asynchronous-inserts',
    '/detached-parts',
    '/view-refreshes',
    '/index-analytics',
    '/metrics',
    '/asynchronous-metrics',
    '/profiler',
    '/logs/text-log',
    '/logs/stack-traces',
    '/logs/crashes',
    '/opentelemetry-spans',
    '/sql',
    '/explain',
    '/advisor',
    '/dashboard',
    '/schema-diff',
    '/settings-diff',
    '/settings',
    '/mergetree-settings',
    '/replicated-merge-tree-settings',
    '/disks',
    '/storage-economics',
    '/warnings',
    '/background-schedule-pool',
    '/histogram-metrics',
    '/workload-scheduling',
    '/backups',
    '/blob-storage-log',
    '/errors',
    '/page-views',
  ],
}

describe('PRESET_GROUP_TITLES', () => {
  test('DBA, Engineer, and SRE all include Tools & AI', () => {
    expect(PRESET_GROUP_TITLES.dba).toContain('Tools & AI')
    expect(PRESET_GROUP_TITLES.engineer).toContain('Tools & AI')
    expect(PRESET_GROUP_TITLES.sre).toContain('Tools & AI')
  })

  test('every preset name is a real top-level group title', () => {
    const titles = new Set(menuItemsConfig.map((item) => item.title))
    for (const list of Object.values(PRESET_GROUP_TITLES)) {
      for (const title of list) expect(titles.has(title), title).toBe(true)
    }
  })

  for (const preset of ['dba', 'engineer', 'sre'] as const) {
    test(`${preset} keeps every page it showed before the task-group regroup (#3565)`, () => {
      const visible = new Set(
        collectMenuHrefs(
          applyWorkspaceVisibility(menuItemsConfig, {
            workspacePreset: preset,
            hiddenMenuHrefs: [],
          })
        )
      )
      const lost = PRE_3565_PRESET_HREFS[preset].filter(
        (href) => !visible.has(href)
      )
      expect(lost).toEqual([])
    })
  }
})
