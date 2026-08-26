/**
 * Page-render sweep parity — every dashboard route file must appear in the
 * Cypress sweep list (or in SWEEP_EXCLUDED_ROUTES with a documented reason).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const DASHBOARD_ROUTES_DIR = join(import.meta.dir, '../src/routes/(dashboard)')
const SWEEP_FILE = join(
  import.meta.dir,
  '../cypress/e2e/page-render-sweep.cy.ts'
)

/** Routes intentionally omitted from the render sweep. */
export const SWEEP_EXCLUDED_ROUTES = [] as const

function walkDashboardRoutes(dir: string, prefix = ''): string[] {
  const routes: string[] = []

  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('-')) continue

    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      routes.push(...walkDashboardRoutes(fullPath, `${prefix}/${entry}`))
      continue
    }

    if (!entry.endsWith('.tsx') || entry === 'route.tsx') continue

    const base = entry.replace(/\.tsx$/, '')
    const routePath =
      base === 'index'
        ? prefix || '/'
        : `${prefix}/${base}`.replace(/\/index$/, '')

    routes.push(routePath === '' ? '/' : routePath)
  }

  return routes
}

function parseSweepRoutes(source: string): string[] {
  const match = source.match(/const DASHBOARD_ROUTES = \[([\s\S]*?)\] as const/)
  if (!match) {
    throw new Error(
      'Could not parse DASHBOARD_ROUTES from page-render-sweep.cy.ts'
    )
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map(([, route]) => route)
}

describe('page-render sweep parity', () => {
  test('DASHBOARD_ROUTES covers every current dashboard route', () => {
    const discovered = walkDashboardRoutes(DASHBOARD_ROUTES_DIR).sort()
    const sweepRoutes = parseSweepRoutes(
      readFileSync(SWEEP_FILE, 'utf8')
    ).sort()
    const excluded = new Set<string>(SWEEP_EXCLUDED_ROUTES)

    const missing = discovered.filter(
      (route) => !sweepRoutes.includes(route) && !excluded.has(route)
    )
    const extra = sweepRoutes.filter(
      (route) => !discovered.includes(route) && !excluded.has(route)
    )

    expect(missing).toEqual([])
    expect(extra).toEqual([])
    expect(discovered.length).toBe(sweepRoutes.length)
  })
})
