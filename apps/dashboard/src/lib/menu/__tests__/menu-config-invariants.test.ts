/**
 * Structural invariants for src/menu.ts — 1000+ lines of declarative config,
 * the highest-churn file in the app, with no direct test before this one.
 * `MenuItem` has no explicit id field, so "identity" here is: a leaf item's
 * href (its actual navigational destination) and a sibling group's titles
 * (what a user sees listed together in one dropdown).
 *
 * Known-legitimate exceptions, not bugs:
 * - A group parent may repeat its first child's href (e.g. "Merges" both
 *   links directly to /merges AND lists /merges again inside its own
 *   dropdown) — that's a container mirroring its own landing page. Only
 *   *leaf* items (no nested `items`) are required to have a distinct href.
 */

import { RssIcon } from 'lucide-react'
import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'
import type { FeaturePermission } from '@/lib/feature-permissions/types'

import { describe, expect, test } from 'bun:test'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { menuItemPaletteValue } from '@/components/controls/command-palette-utils'
import {
  resolveUnavailable,
  type UnavailableState,
} from '@/lib/menu/unavailable-visibility'
import { ROUTE_TITLE_MAP } from '@/lib/page-title'

/** A settled host under the shipped default (Hide), at the demo's permissions. */
function unavailableState(
  overrides: Partial<UnavailableState>
): UnavailableState {
  return {
    tableAvailable: true,
    metadataDbSatisfied: true,
    availabilityLoading: false,
    dimUnavailablePages: false,
    ...overrides,
  }
}

interface FlatItem {
  item: MenuItem
  isLeaf: boolean
}

function flatten(items: MenuItem[], out: FlatItem[] = []): FlatItem[] {
  for (const item of items) {
    out.push({ item, isLeaf: !item.items || item.items.length === 0 })
    if (item.items) flatten(item.items, out)
  }
  return out
}

const leaves = flatten(menuItemsConfig)
  .filter((f) => f.isLeaf)
  .map((f) => f.item)

describe('menu.ts structural invariants', () => {
  test('every leaf item (no children) has a non-empty href', () => {
    const offenders = leaves.filter((item) => !item.href).map((i) => i.title)
    expect(offenders).toEqual([])
  })

  test('hrefs are unique among leaf items', () => {
    const titlesByHref = new Map<string, string[]>()
    for (const item of leaves) {
      if (!item.href) continue
      const titles = titlesByHref.get(item.href) ?? []
      titles.push(item.title)
      titlesByHref.set(item.href, titles)
    }
    // No exceptions: since #3565 every page lives in exactly one group.
    const duplicates = [...titlesByHref.entries()].filter(
      ([, titles]) => titles.length > 1
    )
    expect(duplicates).toEqual([])
  })

  test('sibling titles are unique within each dropdown / list', () => {
    function checkSiblings(items: MenuItem[], path: string) {
      const counts = new Map<string, number>()
      for (const item of items) {
        counts.set(item.title, (counts.get(item.title) ?? 0) + 1)
      }
      const duplicated = [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([title]) => title)
      expect(duplicated, `duplicate sibling titles under ${path}`).toEqual([])
      for (const item of items) {
        if (item.items) checkSiblings(item.items, `${path} > ${item.title}`)
      }
    }
    checkSiblings(menuItemsConfig, 'root')
  })
})

describe('menu.ts hrefs resolve to a real route file', () => {
  // Pathless TanStack Router layout groups reachable from menu.ts. `api` is
  // excluded — those are data endpoints, never menu hrefs.
  const ROUTE_GROUPS = ['(dashboard)', '(peerdb)']
  const ROUTES_ROOT = fileURLToPath(new URL('../../../routes', import.meta.url))

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('-')) continue // colocated non-route file/dir
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full, out)
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        out.push(full)
      }
    }
    return out
  }

  // Mirrors TanStack Router's file-based conventions used under src/routes:
  // pathless `(group)` segments don't appear in the URL, a folder's
  // `index.tsx` maps to the folder's own path, and `route.tsx` is a layout
  // file with no URL segment of its own.
  function fileToRoutePath(file: string): string | null {
    const rel = relative(ROUTES_ROOT, file).replace(/\.(tsx|ts)$/, '')
    const segments = rel.split('/')
    const basename = segments[segments.length - 1]
    if (basename === 'route' || basename.endsWith('.test')) return null
    const cleaned = segments
      .filter((seg) => !/^\(.*\)$/.test(seg))
      .filter((seg, i, arr) => !(seg === 'index' && i === arr.length - 1))
    return `/${cleaned.join('/')}`
  }

  const knownRoutePaths = new Set(
    ROUTE_GROUPS.flatMap((group) => walk(join(ROUTES_ROOT, group)))
      .map(fileToRoutePath)
      .filter((p): p is string => p !== null)
  )

  test('discovers a meaningful number of route files', () => {
    expect(knownRoutePaths.size).toBeGreaterThan(50)
  })

  test('every leaf href path (before ?) matches an existing route file', () => {
    const offenders = leaves
      .filter((item) => item.href && !/^https?:\/\//.test(item.href))
      .map((item) => ({ title: item.title, path: item.href.split('?')[0] }))
      .filter(({ path }) => !knownRoutePaths.has(path))
    expect(offenders).toEqual([])
  })

  // WHY (#3736): six titled catalog pages shipped with a route but no menu
  // entry, so they were reachable only by typing the URL. A page with a tab
  // title is a user-facing page; it must be in the menu or deliberately off it.
  const NOT_IN_MENU: Readonly<Record<string, string>> = {
    '/': 'redirects to /overview',
    '/part-info': 'drill-down opened from Part Log rows, not a browse page',
    '/peerdb/mirror': 'detail page opened from the PeerDB Mirrors list',
    '/peerdb/peer': 'detail page opened from the PeerDB Peers list',
    '/zookeeper': 'no menu entry yet; the Keeper group covers it (follow-up)',
    '/hub/queries': 'reached via the group hubHref',
    '/hub/data-storage': 'reached via the group hubHref',
    '/hub/cluster-replication': 'reached via the group hubHref',
    '/hub/server': 'reached via the group hubHref',
  }

  test('every titled (dashboard) route is in the menu or on the allow-list', () => {
    const menuPaths = new Set(
      leaves.map((item) => item.href.split('?')[0]).filter(Boolean)
    )
    const missing = Object.keys(ROUTE_TITLE_MAP).filter(
      (path) =>
        knownRoutePaths.has(path) &&
        !menuPaths.has(path) &&
        !(path in NOT_IN_MENU)
    )
    expect(missing).toEqual([])
  })
})

const topGroup = (title: string) =>
  menuItemsConfig.find((item) => item.title === title)
const hrefsOf = (title: string) =>
  topGroup(title)?.items?.map((item) => item.href) ?? []

describe('task-group layout (#3565)', () => {
  // WHY: the sidebar was 16 groups sorted by system-table origin. It is now
  // grouped by what the operator is doing. A new page must join one of these
  // groups, not add a 17th top-level heading.
  test('top level is Overview, 6 task groups, About footer, Settings', () => {
    const top = menuItemsConfig
      .filter((item) => item.engines?.join() !== 'postgres')
      .map((item) => [item.title, item.section])
    expect(top).toEqual([
      ['Overview', 'main'],
      ['Queries', 'main'],
      ['Data & Storage', 'main'],
      ['Cluster & Replication', 'main'],
      ['Server', 'main'],
      ['Alerts & Insights', 'main'],
      ['Tools & AI', 'main'],
      ['About', 'footer'],
      ['Settings', 'others'],
    ])
  })

  test('the sidebar stays two levels deep: no group nests a group', () => {
    // The renderer (nav-main/menu-item.tsx) does not recurse, so a third
    // level would never render.
    const nested = menuItemsConfig.flatMap((group) =>
      (group.items ?? [])
        .filter((child) => child.items?.length)
        .map((child) => `${group.title} > ${child.title}`)
    )
    expect(nested).toEqual([])
  })

  test('Postgres items stay top-level and engine-gated', () => {
    // A ClickHouse-family parent would drop them on a Postgres host
    // (filterMenuItemsByEngine drops the parent first).
    const pg = menuItemsConfig.filter(
      (item) => item.engines?.join() === 'postgres'
    )
    expect(pg.map((item) => item.href)).toEqual([
      '/postgres/queries',
      '/postgres/activity',
    ])
    for (const item of pg) expect(item.engines).toEqual(['postgres'])
  })

  test('children are ordered by task within each group', () => {
    // Runs of related pages (live → history → performance → caches, …) sit
    // together so the later hub pages can take each run as-is.
    expect(hrefsOf('Queries')).toEqual([
      '/running-queries',
      '/user-processes',
      '/history-queries',
      '/recent-queries',
      '/failed-queries',
      '/query-views-log',
      '/query-metric-log',
      '/common-errors',
      '/slow-queries',
      '/slow-query-patterns',
      '/expensive-queries',
      '/expensive-queries-by-memory',
      '/queries/insights',
      '/queries/thread-analysis',
      '/queries/parallelization',
      '/query-cache',
      '/query-condition-cache',
    ])
    expect(hrefsOf('Data & Storage')).toEqual([
      '/tables',
      '/tables-overview',
      '/explorer',
      '/dictionaries',
      '/top-usage-tables',
      '/top-usage-columns',
      '/merges',
      '/merge-performance',
      '/mutations',
      '/moves',
      '/part-log',
      '/detached-parts',
      '/ttl-partition-health',
      '/dropped-tables',
      '/readonly-tables',
      '/view-refreshes',
      '/index-analytics',
      '/projections',
      '/asynchronous-inserts',
      '/kafka-consumers',
      '/rabbitmq-consumers',
      '/peerdb',
      '/peerdb/peers',
      '/disks',
      '/storage-economics',
      '/blob-storage-log',
      '/backups',
    ])
    expect(hrefsOf('Cluster & Replication')).toEqual([
      '/clusters',
      '/fleet',
      '/charts?name=connections-http,connections-interserver',
      '/replicas',
      '/replication-queue',
      '/replicated-fetches',
      '/distributed-ddl-queue',
      '/keeper/overview',
      '/keeper?path=/',
      '/keeper/info',
      '/keeper/connections',
      '/keeper/connection-log',
      '/keeper/log',
      '/keeper/watches',
      '/keeper/deep-dive',
    ])
    expect(hrefsOf('Server')).toEqual([
      '/metrics',
      '/asynchronous-metrics',
      '/histogram-metrics',
      '/profiler',
      '/logs/text-log',
      '/logs/stack-traces',
      '/logs/crashes',
      '/errors',
      '/opentelemetry-spans',
      '/background-schedule-pool',
      '/workload-scheduling',
      '/warnings',
      '/page-views',
      '/users',
      '/roles',
      '/security/management',
      '/security/sessions',
      '/security/login-attempts',
      '/security/audit-log',
    ])
    expect(hrefsOf('Alerts & Insights')).toEqual([
      '/insights',
      '/health',
      '/inbound-events',
      '/traffic',
    ])
    expect(hrefsOf('Tools & AI')).toEqual([
      '/agents',
      '/sql',
      '/explain',
      '/advisor',
      '/dashboard',
      '/schema-diff',
      '/settings-diff',
      '/mcp',
    ])
    expect(hrefsOf('Settings')).toEqual([
      '/agents/settings',
      '/insights-settings',
      '/report-settings',
      '/health-settings',
      '/alert-settings',
      '/settings',
      '/mergetree-settings',
      '/replicated-merge-tree-settings',
    ])
  })

  test('mixed groups do not gate the parent; each child keeps its old feature', () => {
    // WHY: the old groups set `permission` on the parent and children
    // inherited it. Merged groups hold pages with different gates, so a
    // parent gate would hide pages the deployment allows. Every child now
    // carries the gate it used to inherit.
    for (const title of [
      'Data & Storage',
      'Cluster & Replication',
      'Server',
      'Alerts & Insights',
      'Tools & AI',
      'Settings',
    ]) {
      expect(topGroup(title)?.permission, title).toBeUndefined()
    }
    expect(topGroup('Queries')?.permission).toEqual({ feature: 'queries' })

    const featureOf = (href: string) =>
      flatten(menuItemsConfig).find((f) => f.item.href === href && f.isLeaf)
        ?.item.permission?.feature
    const expected: Record<string, FeaturePermission['feature'] | undefined> = {
      '/tables': 'tables',
      '/explorer': 'tables',
      '/merges': 'operations',
      '/backups': 'operations',
      '/peerdb': 'peerdb',
      '/disks': undefined,
      '/clusters': 'cluster',
      '/replicas': 'tables',
      '/keeper/overview': undefined,
      '/metrics': 'metrics',
      '/logs/text-log': 'logs',
      '/errors': 'operations',
      '/users': 'security',
      '/warnings': undefined,
      '/insights': 'insights',
      '/traffic': 'insights',
      '/health': 'health',
      '/inbound-events': 'health',
      '/agents': 'agent',
      '/sql': 'tables',
      '/explain': 'queries',
      '/dashboard': 'dashboard',
      '/schema-diff': 'settings',
      '/mcp': 'mcp',
      '/agents/settings': 'agent',
      '/report-settings': 'insights',
      '/alert-settings': 'health',
      '/settings': 'settings',
      '/replicated-merge-tree-settings': undefined,
    }
    for (const [href, feature] of Object.entries(expected)) {
      expect(featureOf(href), href).toBe(feature)
    }
  })

  test('only true sibling collisions were renamed', () => {
    const titleOf = (href: string) =>
      leaves.find((item) => item.href === href)?.title
    expect(titleOf('/keeper/connections')).toBe('Keeper Connections')
    expect(
      titleOf('/charts?name=connections-http,connections-interserver')
    ).toBe('Connections')
    expect(titleOf('/peerdb')).toBe('PeerDB Mirrors')
    expect(titleOf('/peerdb/peers')).toBe('PeerDB Peers')
    // The /health child keeps "Health and Alert" (#3436): "Health" read as
    // the same page as "Health Settings".
    expect(titleOf('/health')).toBe('Health and Alert')
  })

  test('Tools & AI has no engines tag so Postgres hosts hide the whole group (#3105 / #3115)', () => {
    // Absent engines = default source-engine family. Do not add
    // engines: ['postgres'] — that would show CH-only tools on Postgres.
    const tools = topGroup('Tools & AI')
    expect(tools?.engines).toBeUndefined()
    for (const item of tools?.items ?? []) {
      expect(item.engines, item.href).toBeUndefined()
    }
  })

  test('Inbound Events keeps href, Rss icon, isNew, and health permission (#3134)', () => {
    const inbound = topGroup('Alerts & Insights')?.items?.find(
      (item) => item.href === '/inbound-events'
    )
    expect(inbound?.title).toBe('Inbound Events')
    expect(inbound?.isNew).toBe(true)
    expect(inbound?.permission).toEqual({ feature: 'health' })
    expect(inbound?.icon).toBe(RssIcon)
    expect(inbound?.engines).toBeUndefined()
  })

  test('Health and Alert keeps its Cmd+K keywords (#3436)', () => {
    const health = leaves.find((item) => item.href === '/health')
    expect(health?.keywords).toEqual([
      'health summary',
      'alerts',
      'status',
      'health checks',
    ])
  })
})

describe('availability policy (#3463)', () => {
  // The two classes must not be confused. Traffic's backing table is missing on
  // some hosts → the page can NEVER work there → it leaves the rail. Scheduled
  // Reports only needs a metadata DB the operator can configure → it stays
  // greyed so a self-hoster who adds D1 later can still find it.
  const child = (href: string) => leaves.find((item) => item.href === href)

  const hiddenOnDemoHost = (item: MenuItem) =>
    resolveUnavailable(
      item,
      unavailableState({ tableAvailable: false, metadataDbSatisfied: false })
    ).visibility

  test('Traffic declares tableCheck and therefore HIDES by default', () => {
    const traffic = child('/traffic')
    expect(traffic?.tableCheck).toBe('system.query_log')
    expect(traffic?.hideWhenUnavailable).toBeUndefined()
    expect(hiddenOnDemoHost(traffic!)).toBe('hidden')
  })

  test('Scheduled Reports is config-gated and therefore DIMS by default', () => {
    const reports = child('/report-settings')
    expect(reports?.requiresMetadataDb).toBe(true)
    expect(reports?.tableCheck).toBeUndefined()
    expect(reports?.hideWhenUnavailable).toBeUndefined()
    expect(hiddenOnDemoHost(reports!)).toBe('dimmed')
  })

  test('an item can opt in to hiding its config gate', () => {
    const optIn = {
      requiresMetadataDb: true,
      hideWhenUnavailable: true,
    }
    expect(
      resolveUnavailable(
        optIn,
        unavailableState({ tableAvailable: true, metadataDbSatisfied: false })
      ).visibility
    ).toBe('hidden')
  })

  test('Insights and Health and Alert have no tableCheck, so Alerts & Insights is never empty', () => {
    expect(child('/insights')?.tableCheck).toBeUndefined()
    expect(child('/health')?.tableCheck).toBeUndefined()
  })
})

describe('command-palette aliases (⌘K)', () => {
  test('DBA pages carry keywords so Cmd+K matches nicknames and routes', () => {
    const byHref = Object.fromEntries(leaves.map((item) => [item.href, item]))
    const required: Record<string, string[]> = {
      '/schema-diff': ['schema diff', 'ddl', 'schema-diff'],
      '/settings-diff': ['config diff', 'settings-diff'],
      '/advisor': ['query advisor', 'schema advisor', 'ttl'],
      '/ttl-partition-health': ['ttl-partition-health', 'partition health'],
    }
    for (const [href, aliases] of Object.entries(required)) {
      const item = byHref[href]
      expect(item, href).toBeDefined()
      const haystack = menuItemPaletteValue(item).toLowerCase()
      for (const alias of aliases) {
        expect(haystack, `${href} should match ${alias}`).toContain(
          alias.toLowerCase()
        )
      }
    }
  })

  test('Cmd+K matches the document <title> even when it differs from the sidebar label', () => {
    const byHref = Object.fromEntries(leaves.map((item) => [item.href, item]))
    const titles: Record<string, string> = {
      '/ttl-partition-health': 'TTL & Partition Health',
      '/schema-diff': 'Cross-Host Schema Compare',
      '/settings-diff': 'Cross-Host Settings Diff',
      '/explorer': 'Database Explorer',
      '/overview': 'Cluster Overview',
    }
    for (const [href, title] of Object.entries(titles)) {
      const item = byHref[href]
      expect(item, href).toBeDefined()
      expect(menuItemPaletteValue(item)).toContain(title)
    }
  })
})
