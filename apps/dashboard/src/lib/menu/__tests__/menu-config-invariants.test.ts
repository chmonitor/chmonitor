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
 * - Data Explorer (`/explorer`) is listed under both Tools and Tables.
 */

import { RssIcon } from 'lucide-react'
import { menuItemsConfig } from '@/menu'

import type { MenuItem } from '@/components/menu/types'

import { describe, expect, test } from 'bun:test'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    const allowedDupHrefs = new Set(['/explorer'])
    const duplicates = [...titlesByHref.entries()].filter(
      ([href, titles]) => titles.length > 1 && !allowedDupHrefs.has(href)
    )
    expect(duplicates).toEqual([])
  })

  test('Data Explorer is listed under both Tools and Tables', () => {
    const hrefsOf = (title: string) =>
      menuItemsConfig
        .find((item) => item.title === title)
        ?.items?.map((item) => item.href) ?? []
    expect(hrefsOf('Tools')).toContain('/explorer')
    expect(hrefsOf('Tables')).toContain('/explorer')
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
})

describe('Health group (inbound events nest, #3134)', () => {
  const health = menuItemsConfig.find((item) => item.title === 'Health')

  test('Inbound Events is a Health child after Alert Settings, not a top-level item', () => {
    expect(
      menuItemsConfig.some((item) => item.href === '/inbound-events')
    ).toBe(false)
    expect(health?.items?.map((item) => item.href)).toEqual([
      '/health',
      '/health-settings',
      '/alert-settings',
      '/inbound-events',
    ])
  })

  test('keeps href, Rss icon, isNew, and health permission on the leaf', () => {
    const inbound = health?.items?.find(
      (item) => item.href === '/inbound-events'
    )
    expect(inbound?.title).toBe('Inbound Events')
    expect(inbound?.isNew).toBe(true)
    expect(inbound?.permission).toEqual({ feature: 'health' })
    expect(inbound?.icon).toBe(RssIcon)
    expect(inbound?.engines).toBeUndefined()
  })

  test('Health parent stays default source-engine family (no postgres engines tag)', () => {
    expect(health?.engines).toBeUndefined()
    expect(health?.permission).toEqual({ feature: 'health' })
    expect(health?.section).toBe('main')
  })
})

describe('Tools group (interactive utilities)', () => {
  const tools = menuItemsConfig.find((item) => item.title === 'Tools')

  test('is the last main-section group: after Logs, before About (#3117)', () => {
    const titles = menuItemsConfig.map((item) => item.title)
    const toolsAt = titles.indexOf('Tools')
    expect(toolsAt).toBeGreaterThan(titles.indexOf('Logs'))
    expect(toolsAt).toBeLessThan(titles.indexOf('About'))
    expect(toolsAt).toBeLessThan(titles.indexOf('System'))
    expect(toolsAt).toBeLessThan(titles.indexOf('Cluster'))
    expect(toolsAt).toBeLessThan(titles.indexOf('Operations'))
    expect(toolsAt).toBeGreaterThan(titles.indexOf('AI Agent'))
    expect(tools?.section).toBe('main')
  })

  test('lists daily-use utilities in most-used-first order', () => {
    expect(tools?.items?.map((item) => item.href)).toEqual([
      '/sql',
      '/explorer',
      '/explain',
      '/advisor',
      '/dashboard',
      '/schema-diff',
      '/settings-diff',
    ])
  })

  test('parent does not over-gate children; each child keeps its feature', () => {
    expect(tools?.permission).toBeUndefined()
    const byHref = Object.fromEntries(
      (tools?.items ?? []).map((item) => [item.href, item.permission?.feature])
    )
    expect(byHref['/sql']).toBe('tables')
    expect(byHref['/explorer']).toBe('tables')
    expect(byHref['/explain']).toBe('queries')
    expect(byHref['/advisor']).toBe('queries')
    expect(byHref['/dashboard']).toBe('dashboard')
    expect(byHref['/schema-diff']).toBe('settings')
    expect(byHref['/settings-diff']).toBe('settings')
  })

  test('has no engines tag so Postgres hosts hide the whole group (#3105 / #3115)', () => {
    // Absent engines = default source-engine family. Do not add
    // engines: ['postgres'] — that would show CH-only tools on Postgres.
    expect(tools?.engines).toBeUndefined()
    expect(tools?.engines?.includes('postgres') ?? false).toBe(false)
    for (const item of tools?.items ?? []) {
      expect(item.engines, item.href).toBeUndefined()
      expect(item.engines?.includes('postgres') ?? false, item.href).toBe(false)
    }
  })

  test('moved pages are gone from their old groups', () => {
    const hrefsOf = (title: string) =>
      menuItemsConfig
        .find((item) => item.title === title)
        ?.items?.map((item) => item.href) ?? []

    expect(hrefsOf('Tables')).not.toContain('/sql')
    expect(hrefsOf('Tables')).toContain('/explorer')
    expect(hrefsOf('Tables')).toContain('/ttl-partition-health')
    expect(hrefsOf('Queries')).not.toContain('/explain')
    expect(hrefsOf('Queries')).not.toContain('/advisor')
    expect(hrefsOf('Operations')).not.toContain('/dashboard')
    expect(hrefsOf('System')).not.toContain('/schema-diff')
    expect(hrefsOf('System')).not.toContain('/settings-diff')
    expect(hrefsOf('System')).not.toContain('/ttl-partition-health')
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
      const haystack = [
        item.title,
        item.href,
        item.description,
        ...(item.keywords ?? []),
      ]
        .join(' ')
        .toLowerCase()
      for (const alias of aliases) {
        expect(haystack, `${href} should match ${alias}`).toContain(
          alias.toLowerCase()
        )
      }
    }
  })
})
