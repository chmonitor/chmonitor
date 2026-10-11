import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROUTES = fileURLToPath(new URL('.', import.meta.url))
const GROUPS = ['(dashboard)', '(peerdb)']

/** Routes that intentionally have no `head`, with the reason. */
const ALLOWLIST: Record<string, string> = {
  '(dashboard)/route.tsx': 'layout route, renders only an Outlet',
  '(peerdb)/route.tsx': 'layout route, renders only an Outlet',
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    // TanStack Router ignores `-` prefixed files/dirs (colocated components).
    if (name.startsWith('-')) return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    return p.endsWith('.tsx') ? [p] : []
  })
}

describe('route head coverage', () => {
  const rels = GROUPS.flatMap((g) => walk(join(ROUTES, g))).map((f) =>
    relative(ROUTES, f)
  )

  test('finds route files', () => {
    expect(rels.length).toBeGreaterThan(10)
  })

  test('every route declares head or is allowlisted with a reason', () => {
    const missing = rels
      .filter((rel) => !(rel in ALLOWLIST))
      .filter(
        (rel) => !/\bhead\s*:/.test(readFileSync(join(ROUTES, rel), 'utf8'))
      )
    expect(missing).toEqual([])
  })

  test('allowlist entries still exist', () => {
    for (const k of Object.keys(ALLOWLIST)) expect(rels).toContain(k)
  })
})
