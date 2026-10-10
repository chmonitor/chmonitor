/**
 * Coverage test for `page-data-map.ts`: the agent can only answer "what does
 * the X page show?" for pages the map knows, so a new page, a new queryConfig
 * on a page, or a new chartName must land in the map in the same change.
 *
 * It scans every `routes/(dashboard)/**\/*.tsx` file (plus the page's
 * `-<name>/` sibling folder and the chart components it imports) for:
 *  - `QueryConfig`s imported from `@/lib/query-config/**` (resolved to `.name`,
 *    plus their `relatedCharts`), and
 *  - literal `chartName: '...'` / `chartName="..."` usages,
 * and asserts each one is listed under that page's route and resolves in the
 * live table / chart registry. Every route file and every menu href must be in
 * the map or in `NON_DATA_PAGES`.
 */

import { menuItemsConfig } from '@/menu'

import {
  NON_DATA_PAGES,
  normalizePageKey,
  PAGE_DATA_MAP,
} from '../page-data-map'
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { hasChart } from '@/lib/api/chart-registry'
import { hasTable } from '@/lib/api/table-registry'

const SRC = join(import.meta.dir, '..', '..', '..', '..')
const ROUTES = join(SRC, 'routes', '(dashboard)')
/** `relatedCharts` layout markers, not charts. */
const LAYOUT_MARKERS = new Set(['break'])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return p.endsWith('.tsx') || p.endsWith('.ts') ? [p] : []
  })
}

function resolveAlias(spec: string): string | null {
  const base = join(SRC, spec.slice(2))
  for (const c of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(c)) return c
  }
  return null
}

const CHART_RE = /chartName[=:]\s*\{?\s*['"]([a-z0-9-]+)['"]/g
const chartLiterals = (src: string) =>
  [...src.matchAll(CHART_RE)].map((m) => m[1])

interface Found {
  route: string
  file: string
  configs: string[]
  charts: string[]
}

async function scanRoutes(): Promise<Found[]> {
  const found: Found[] = []
  // Route files only: skip `-private` folders and helper modules.
  const files = walk(ROUTES).filter(
    (f) =>
      f.endsWith('.tsx') &&
      !f
        .slice(ROUTES.length)
        .split('/')
        .some((seg) => seg.startsWith('-'))
  )
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const m = src.match(/createFileRoute\(\s*'\/\(dashboard\)(\/[^']*)'\s*\)/)
    if (!m) continue
    const route = m[1].replace(/\/$/, '') || '/'
    if (route === '/') continue
    const configs: string[] = []
    const charts = new Set(chartLiterals(src))

    for (const im of src.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*'(@\/[^']+)'/g
    )) {
      const names = im[1]
        .split(',')
        .map((s) => s.trim().replace(/^type\s+/, ''))
        .filter(Boolean)
      const spec = im[2]
      if (spec.startsWith('@/lib/query-config')) {
        const path = resolveAlias(spec)
        if (!path) continue
        const mod = await import(path)
        for (const n of names) {
          const cfg = mod[n]
          if (!/Config$/.test(n) || typeof cfg?.name !== 'string') continue
          configs.push(cfg.name)
          for (const rc of cfg.relatedCharts ?? []) {
            const chart = Array.isArray(rc) ? rc[0] : rc
            if (typeof chart === 'string' && !LAYOUT_MARKERS.has(chart))
              charts.add(chart)
          }
        }
      } else if (spec.startsWith('@/components/charts/')) {
        const path = resolveAlias(spec)
        if (path)
          for (const c of chartLiterals(readFileSync(path, 'utf8')))
            charts.add(c)
      }
    }

    const sibling = join(dirname(file), `-${basename(file, '.tsx')}`)
    if (existsSync(sibling) && statSync(sibling).isDirectory()) {
      for (const f of walk(sibling))
        for (const c of chartLiterals(readFileSync(f, 'utf8'))) charts.add(c)
    }

    found.push({
      route,
      file: file.slice(ROUTES.length + 1),
      configs,
      charts: [...charts],
    })
  }
  return found
}

const scanned = await scanRoutes()

function menuHrefs(): string[] {
  const out: string[] = []
  const visit = (items: readonly any[]) => {
    for (const item of items) {
      // Group headers carry an empty href; they are not pages.
      if (typeof item.href === 'string' && item.href !== '') out.push(item.href)
      if (Array.isArray(item.items)) visit(item.items)
    }
  }
  visit(menuItemsConfig as readonly any[])
  return out
}

describe('page-data-map — coverage of routes/(dashboard)', () => {
  test('the scan found the dashboard pages (guards a broken glob)', () => {
    expect(scanned.length).toBeGreaterThan(80)
    expect(scanned.find((s) => s.route === '/merges')?.configs).toContain(
      'merges'
    )
  })

  test('every route file is in the map or in NON_DATA_PAGES', () => {
    const missing = scanned
      .filter((s) => !PAGE_DATA_MAP[s.route] && !NON_DATA_PAGES[s.route])
      .map((s) => `${s.route} (${s.file})`)
    expect(missing).toEqual([])
  })

  test("every queryConfig a page renders is listed under that page's route", () => {
    const missing: string[] = []
    for (const s of scanned) {
      const entry = PAGE_DATA_MAP[s.route]
      for (const c of s.configs) {
        if (!entry?.configs.includes(c)) missing.push(`${s.route}: ${c}`)
      }
    }
    expect(missing).toEqual([])
  })

  test("every chartName a page renders is listed under that page's route", () => {
    const missing: string[] = []
    for (const s of scanned) {
      const entry = PAGE_DATA_MAP[s.route]
      for (const c of s.charts) {
        if (!entry?.charts.includes(c)) missing.push(`${s.route}: ${c}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('every mapped config and chart resolves in the live registries', () => {
    const unresolved: string[] = []
    for (const [route, entry] of Object.entries(PAGE_DATA_MAP)) {
      for (const c of entry.configs)
        if (!hasTable(c)) unresolved.push(`${route}: config ${c}`)
      for (const c of entry.charts)
        if (!hasChart(c)) unresolved.push(`${route}: chart ${c}`)
    }
    expect(unresolved).toEqual([])
  })

  test('every menu href is in the map or in NON_DATA_PAGES', () => {
    const missing = menuHrefs()
      .map((href) => ({ href, key: normalizePageKey(href) }))
      .filter(({ key }) => !PAGE_DATA_MAP[key] && !NON_DATA_PAGES[key])
      .map(({ href }) => href)
    expect(missing).toEqual([])
  })

  test('no route is both a data page and a non-data page', () => {
    const both = Object.keys(NON_DATA_PAGES).filter((r) => PAGE_DATA_MAP[r])
    expect(both).toEqual([])
  })
})
