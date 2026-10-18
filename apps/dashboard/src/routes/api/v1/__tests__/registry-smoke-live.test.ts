/**
 * In-process smoke of every `/api/v1/charts/$name` and `/api/v1/tables/$name`
 * name against a REAL ClickHouse server. Runs in CI's `test-queries-config`
 * job and self-skips everywhere else, the same way
 * `lib/query-config/__tests__/output-columns-live.test.ts` does.
 *
 * Each registered name goes through the real route handler with `hostId=0`.
 * The response must be 200 with `success: true`: data, or the classified
 * "unavailable" body an optional chart or table gets when its table is
 * missing. Any other status (a 500, or a 404 for a column the server lacks)
 * is a failure. Tables whose selected SQL has a `{name:Type}` placeholder with
 * no default are called twice: bare (400 `validation_error`, #3918) and with
 * real params (200). Status-code regressions such as #3752 -> #3759 and #3748
 * were only found after merge.
 */

import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'

import { beforeAll, describe, expect, it } from 'bun:test'
import { fetchData } from '@chm/clickhouse-client'
import {
  getClickHouseVersion,
  selectVersionedSql,
} from '@chm/clickhouse-client/clickhouse-version'
import { getAvailableCharts } from '@/lib/api/chart-registry'
import { getAvailableTables, getTableQuery } from '@/lib/api/table-registry'
import { handler as chartHandler } from '@/routes/api/v1/charts/$name'
import { handler as tableHandler } from '@/routes/api/v1/tables/$name'

// Hundreds of requests from one client IP in a minute; the default API limit
// (100/min) would turn the tail of the sweep into 429s.
process.env.RATE_LIMIT_API_PER_MIN = '100000'

type Handler = (request: Request, name: string) => Promise<Response>

const ROUTES: { kind: string; handler: Handler; names: () => string[] }[] = [
  { kind: 'charts', handler: chartHandler, names: getAvailableCharts },
  { kind: 'tables', handler: tableHandler, names: getAvailableTables },
]

async function getLiveVersion(): Promise<ClickHouseVersion | null> {
  if (!process.env.CLICKHOUSE_HOST) return null
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 3000)
    )
    return await Promise.race([getClickHouseVersion(0), timeout])
  } catch {
    return null
  }
}

const PLACEHOLDER = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:[^{}]+\}/g

/** Placeholders in the SQL the server would run that `defaultParams` leave unset. */
function requiredParams(name: string, version: ClickHouseVersion): string[] {
  const def = getTableQuery(name, { hostId: 0, searchParams: {} })
  if (!def) return []
  const sql = selectVersionedSql(def.queryConfig.sql, version)
  const missing = new Set<string>()
  for (const [, param] of sql.matchAll(PLACEHOLDER)) {
    const value = def.queryParams?.[param]
    if (value === undefined || value === null) missing.add(param)
  }
  return [...missing]
}

async function firstCluster(): Promise<string | null> {
  const { data } = await fetchData<{ cluster: string }[]>({
    query: 'SELECT cluster FROM system.clusters LIMIT 1',
    hostId: 0,
    format: 'JSONEachRow',
  })
  return data?.[0]?.cluster ?? null
}

async function call(kind: string, handler: Handler, name: string, qs = '') {
  const res = await handler(
    new Request(
      `http://localhost/api/v1/${kind}/${encodeURIComponent(name)}?hostId=0${qs}`
    ),
    name
  )
  const text = await res.text()
  let body: { success?: boolean; error?: { type?: string } } | null = null
  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }
  return { status: res.status, body, text }
}

function request(kind: string, name: string, hostId: string): Request {
  return new Request(
    `http://localhost/api/v1/${kind}/${encodeURIComponent(name)}?hostId=${hostId}`
  )
}

describe('/api/v1 chart and table routes against a live ClickHouse (optional)', () => {
  let liveVersion: ClickHouseVersion | null = null

  beforeAll(async () => {
    liveVersion = await getLiveVersion()
    if (!liveVersion) {
      console.log(
        '⏭️  Skipping live API smoke tests - ClickHouse not available (set CLICKHOUSE_HOST)'
      )
    }
  }, 10000)

  it('has a live server whenever one is supposed to be provisioned', () => {
    if (process.env.CHM_LIVE_CLICKHOUSE) expect(liveVersion).not.toBeNull()
  })

  for (const route of ROUTES) {
    it(`answers every ${route.kind} name with 200 and success`, async () => {
      if (!liveVersion) return // Skip - no live ClickHouse
      const failed: string[] = []
      let unavailable = 0
      const names = route.names().sort()

      for (const name of names) {
        if (
          route.kind === 'tables' &&
          requiredParams(name, liveVersion).length
        ) {
          continue // covered by the required-params test below
        }
        const res = await route.handler(request(route.kind, name, '0'), name)
        const text = await res.text()
        let body: {
          success?: boolean
          error?: { type?: string; message?: string }
          metadata?: { unavailable?: unknown }
        } | null = null
        try {
          body = JSON.parse(text)
        } catch {
          body = null
        }
        if (res.status === 200 && body?.success === true) {
          if (body.metadata?.unavailable) unavailable++
          continue
        }
        const reason = body?.error
          ? `${body.error.type}: ${body.error.message}`
          : text
        failed.push(
          `${route.kind}/${name} -> ${res.status} ${reason.split('\n')[0].slice(0, 200)}`
        )
      }

      console.log(
        `/api/v1/${route.kind} on ${liveVersion.raw}: ${names.length} names, ${unavailable} unavailable, ${failed.length} failed`
      )
      expect(names.length).toBeGreaterThan(0)
      expect(failed).toEqual([])
    }, 180000)

    if (route.kind === 'tables') {
      it('answers tables with required params 400 bare and 200 with real params', async () => {
        if (!liveVersion) return // Skip - no live ClickHouse
        const version = liveVersion
        const required = new Map(
          route
            .names()
            .sort()
            .map((n) => [n, requiredParams(n, version)] as const)
            .filter(([, params]) => params.length > 0)
        )
        expect(required.size).toBeGreaterThan(0)

        const cluster = await firstCluster()
        const known: Record<string, string | null> = {
          database: 'system',
          table: 'one',
          cluster,
        }
        const failed: string[] = []

        for (const [name, params] of required) {
          const bare = await call(route.kind, route.handler, name)
          if (
            bare.status !== 400 ||
            bare.body?.error?.type !== 'validation_error'
          ) {
            failed.push(
              `${name} bare -> ${bare.status} ${bare.text.slice(0, 160)}, want 400 validation_error`
            )
          }

          const unknown = params.filter((p) => !(p in known))
          if (unknown.length) {
            failed.push(
              `${name}: no real value known for ${unknown.join(', ')}`
            )
            continue
          }
          if (params.some((p) => known[p] === null)) {
            console.log(`${name}: skipped real-params call, no cluster`)
            continue
          }
          const qs = params
            .map((p) => `&${p}=${encodeURIComponent(known[p] as string)}`)
            .join('')
          const full = await call(route.kind, route.handler, name, qs)
          if (full.status !== 200 || full.body?.success !== true) {
            failed.push(
              `${name} ${params.join(',')} -> ${full.status} ${full.text.slice(0, 160)}`
            )
          }
        }

        console.log(
          `tables with required params: ${[...required.keys()].join(', ')}`
        )
        expect(failed).toEqual([])
      }, 60000)
    }

    // Validation runs before any query, so this needs no server.
    it(`rejects a fractional hostId on ${route.kind} with 400`, async () => {
      const name = route.names()[0]
      const res = await route.handler(request(route.kind, name, '1.5'), name)
      expect(res.status).toBe(400)
    })
  }
})
