/**
 * #3495 — GET /api/v1/config reports `capabilities.health`, the per-feature
 * answer the alert panels ask instead of guessing from `metadataDb.available`.
 *
 * The tri-state (`unknown | available | unavailable`) is asserted at the API
 * boundary: the real route body is fed to the same combiner the panels use.
 * The server never says `unknown`; the client does, when the field is absent.
 *
 * Agreement: under the SAME platform mock and env, `getHealthDb()` — the
 * executor every store calls, whose `null` becomes the 501 — is null exactly
 * when the route says `'none'`. So the capability and the probe cannot
 * disagree.
 *
 * `mock.module('@chm/platform')` is process-global in bun and must run before
 * the route imports, which is why this lives in its own file.
 */

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fakeD1 = { prepare: () => ({}), batch: async () => [] }
let boundD1 = new Set<string>()

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: (name: string) => (boundD1.has(name) ? fakeD1 : null),
    getQueue: () => null,
    getDurableObjectNamespace: () => null,
  }),
}))

const { Route } = await import('../config')
const { getHealthDb, MAINTENANCE_D1_BINDINGS } = await import(
  '@/lib/health/resolve-store'
)
const { resolveHealthStoreAvailability } = await import(
  '@/lib/health/store-availability'
)

type GetHandler = () => Promise<Response>
const handler = (
  Route.options.server as { handlers?: { GET?: GetHandler } } | undefined
)?.handlers?.GET
if (!handler) throw new Error('Route has no GET handler')

const KEYS = [
  'CHM_STATE_CLICKHOUSE_URL',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

afterEach(() => {
  boundD1 = new Set()
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

interface Body {
  metadataDb?: { available?: boolean }
  capabilities?: {
    read: boolean
    write: boolean
    health?: { backend: string; maintenanceWindowsBackend: string }
  }
}

async function load(setup: {
  d1?: string[]
  ch?: boolean
  pg?: boolean
}): Promise<Body> {
  for (const k of KEYS) delete process.env[k]
  boundD1 = new Set(setup.d1 ?? [])
  if (setup.ch) process.env.CHM_STATE_CLICKHOUSE_URL = 'http://ch:8123'
  if (setup.pg) process.env.DATABASE_URL = 'postgres://u:p@pg:5432/chm'
  const res = await handler!()
  expect(res.status).toBe(200)
  return (await res.json()) as Body
}

function tri(body: Body, store?: 'maintenanceWindows') {
  return resolveHealthStoreAvailability({
    capability: body.capabilities?.health as never,
    configLoading: false,
    store,
  })
}

describe('GET /api/v1/config capabilities.health (#3495)', () => {
  test('D1 bound → d1, available', async () => {
    const body = await load({ d1: ['CHM_CLOUD_D1'] })
    expect(body.capabilities?.health?.backend).toBe('d1')
    expect(tri(body)).toBe('available')
  })

  test('Postgres only → postgres, available', async () => {
    const body = await load({ pg: true })
    expect(body.capabilities?.health?.backend).toBe('postgres')
    expect(tri(body)).toBe('available')
  })

  test('ClickHouse-only: metadataDb is available but health is NOT', async () => {
    // The #3493 gap this field exists to close: one response, two answers.
    const body = await load({ ch: true })
    expect(body.metadataDb?.available).toBe(true)
    expect(body.capabilities?.health?.backend).toBe('none')
    expect(tri(body)).toBe('unavailable')
  })

  test('nothing bound → none, unavailable', async () => {
    const body = await load({})
    expect(body.metadataDb?.available).toBe(false)
    expect(body.capabilities?.health).toEqual({
      backend: 'none',
      maintenanceWindowsBackend: 'none',
    })
    expect(tri(body)).toBe('unavailable')
  })

  test('health is additive: the anonymous read/write answer is unchanged', async () => {
    const body = await load({ pg: true })
    expect(typeof body.capabilities?.read).toBe('boolean')
    expect(typeof body.capabilities?.write).toBe('boolean')
  })

  test('a body without the field (older server) is unknown, never available', () => {
    expect(tri({ capabilities: { read: true, write: true } })).toBe('unknown')
    expect(tri({})).toBe('unknown')
  })

  test('MAINTENANCE_D1 alone serves maintenance windows only', async () => {
    const body = await load({ d1: ['MAINTENANCE_D1'] })
    expect(body.capabilities?.health?.backend).toBe('none')
    expect(body.capabilities?.health?.maintenanceWindowsBackend).toBe('d1')
    expect(tri(body)).toBe('unavailable')
    expect(tri(body, 'maintenanceWindows')).toBe('available')
  })
})

describe('capability and the store 501 cannot disagree', () => {
  const cases = [
    { d1: [] as string[], ch: false, pg: false },
    { d1: [], ch: true, pg: false },
    { d1: [], ch: false, pg: true },
    { d1: [], ch: true, pg: true },
    { d1: ['CHM_CLOUD_D1'], ch: false, pg: false },
    { d1: ['MAINTENANCE_D1'], ch: true, pg: false },
    { d1: ['MAINTENANCE_D1', 'CHM_CLOUD_D1'], ch: false, pg: true },
  ]
  for (const c of cases) {
    test(`D1=${c.d1.join('+') || '-'} CH=${c.ch} PG=${c.pg}`, async () => {
      const body = await load(c)
      const health = body.capabilities!.health!
      // getHealthDb() === null is what every store turns into a 501.
      expect(getHealthDb() === null).toBe(health.backend === 'none')
      expect(
        getHealthDb({ bindingNames: MAINTENANCE_D1_BINDINGS }) === null
      ).toBe(health.maintenanceWindowsBackend === 'none')
    })
  }

  test('MAINTENANCE_D1_BINDINGS matches the maintenance store', () => {
    // The store keeps its own (unexported) list; fail loud on drift.
    const src = readFileSync(
      join(import.meta.dir, '../../../../lib/health/maintenance-windows.ts'),
      'utf8'
    )
    const match = src.match(/const D1_BINDING_NAMES = \[([^\]]*)\]/)
    expect(match).not.toBeNull()
    const names = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(names).toEqual([...MAINTENANCE_D1_BINDINGS])
  })
})
