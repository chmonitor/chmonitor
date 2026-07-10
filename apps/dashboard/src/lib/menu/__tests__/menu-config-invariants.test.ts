/**
 * Structural invariants for src/menu.ts — 1000+ lines of declarative config,
 * the highest-churn file in the app, with no direct test before this one.
 * `MenuItem` has no explicit id field, so "identity" here is: a leaf item's
 * href (its actual navigational destination) and a sibling group's titles
 * (what a user sees listed together in one dropdown).
 *
 * Known-legitimate exception, not a bug: a group parent may repeat its first
 * child's href (e.g. "Merges" both links directly to /merges AND lists
 * /merges again inside its own dropdown with a description) — that's a
 * container mirroring its own landing page. Only *leaf* items (no nested
 * `items`) are required to have a distinct href.
 */

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
})
