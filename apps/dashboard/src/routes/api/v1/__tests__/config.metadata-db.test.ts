/**
 * #3493 — route-level check that GET /api/v1/config reports
 * `metadataDb.available` exactly as `resolveStateBackend()` resolves, for the
 * env legs a test can set (ClickHouse state × Postgres). The D1 leg is covered
 * by the injectable-probe matrix in `lib/state-backend`; here no D1 binding
 * exists, so this also proves the route is not re-deriving the check inline.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { resolveStateBackend } from '@/lib/state-backend/config'

type GetHandler = () => Promise<Response>

const { Route } = await import('../config')
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
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

async function available(): Promise<boolean> {
  const res = await handler!()
  const body = (await res.json()) as { metadataDb?: { available?: boolean } }
  return body.metadataDb?.available as boolean
}

describe('GET /api/v1/config metadataDb.available (#3493)', () => {
  for (const ch of [false, true])
    for (const pg of [false, true]) {
      test(`CH=${ch} PG=${pg}`, async () => {
        for (const k of KEYS) delete process.env[k]
        if (ch) process.env.CHM_STATE_CLICKHOUSE_URL = 'http://ch:8123'
        if (pg) process.env.DATABASE_URL = 'postgres://u:p@pg:5432/chm'

        const flag = await available()
        expect(flag).toBe(resolveStateBackend() !== null)
        // Concretely: ClickHouse-only is no longer under-reported, and
        // nothing bound fails closed.
        expect(flag).toBe(ch || pg)
      })
    }
})
