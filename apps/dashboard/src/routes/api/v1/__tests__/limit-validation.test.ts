/**
 * ?limit= validation on the insights/findings read routes: a bad value is a
 * 400 (never silently clamped to a 1-row response), a valid one reaches the
 * reader, an oversized one is clamped to 1000, and a 500 never echoes the raw
 * error message.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
    CHM_FEATURE_POSTGRES_SOURCE: 'true',
    PEERDB_API_URL: 'http://peerdb.invalid',
  },
}))

mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: mock(() => undefined),
  bridgePeerDBEnv: mock(() => undefined),
  bridgePostgresEnv: mock(() => undefined),
}))

mock.module('@/lib/cloud/reject-demo-host', () => ({
  isDemoHostBlockedForRequest: async () => false,
}))

const readInsights = mock(async (..._a: unknown[]) => [] as unknown[])
const readPeerDB = mock(async (..._a: unknown[]) => [] as unknown[])
const readPostgres = mock(async (..._a: unknown[]) => [] as unknown[])
const fetchData = mock(async (..._a: unknown[]) => ({ data: [], error: null }))

mock.module('@/lib/insights/read-insights', () => ({ readInsights }))
mock.module('@/lib/insights/read-peerdb-insights', () => ({
  readPeerDBInsights: readPeerDB,
}))
mock.module('@/lib/insights/read-postgres-insights', () => ({
  readPostgresInsights: readPostgres,
}))

import * as realClient from '@chm/clickhouse-client'

mock.module('@chm/clickhouse-client', () => ({ ...realClient, fetchData }))

type Handler = (ctx: { request: Request }) => Promise<Response>
function handlerOf(route: { options: { server?: unknown } }): Handler {
  const h = (route.options.server as { handlers?: { GET?: Handler } })?.handlers
    ?.GET
  if (!h) throw new Error('no GET handler')
  return h
}

const { Route: insightsRoute } = await import('../insights')
const { Route: findingsRoute } = await import('../findings')
const { Route: peerdbRoute } = await import('../insights/peerdb')
const { Route: postgresRoute } = await import('../insights/postgres')

const cases = [
  {
    name: 'insights',
    handler: handlerOf(insightsRoute),
    url: '/api/v1/insights?host=0',
    reader: readInsights,
  },
  {
    name: 'findings',
    handler: handlerOf(findingsRoute),
    url: '/api/v1/findings?host=0',
    reader: fetchData,
  },
  {
    name: 'peerdb',
    handler: handlerOf(peerdbRoute),
    url: '/api/v1/insights/peerdb?x=1',
    reader: readPeerDB,
  },
  {
    name: 'postgres',
    handler: handlerOf(postgresRoute),
    url: '/api/v1/insights/postgres?pg=0',
    reader: readPostgres,
  },
]

/** The limit the reader was given (findings embeds it in the SQL). */
function limitSeen(name: string, reader: (typeof cases)[number]['reader']) {
  const call = reader.mock.calls[0] as unknown[]
  if (name === 'findings') {
    const sql = (call[0] as { query: string }).query
    return Number(/LIMIT (\d+)/.exec(sql)?.[1])
  }
  return (call.at(-1) as { limit?: number }).limit
}

for (const c of cases) {
  describe(`GET ${c.name} ?limit=`, () => {
    beforeEach(() => {
      c.reader.mockClear()
    })
    const call = (limit: string) =>
      c.handler({ request: new Request(`http://x${c.url}&limit=${limit}`) })

    for (const bad of ['abc', '0', '-5', '1.5']) {
      test(`limit=${bad} is a 400 and never reaches the reader`, async () => {
        const res = await call(bad)
        expect(res.status).toBe(400)
        expect(c.reader).not.toHaveBeenCalled()
      })
    }

    test('valid limit passes through', async () => {
      const res = await call('25')
      expect(res.status).toBe(200)
      expect(limitSeen(c.name, c.reader)).toBe(25)
    })

    test('over max is clamped to 1000', async () => {
      const res = await call('999999')
      expect(res.status).toBe(200)
      expect(limitSeen(c.name, c.reader)).toBe(1000)
    })
  })
}

describe('500 responses are sanitized', () => {
  for (const c of cases.filter((x) => x.name !== 'findings')) {
    test(`${c.name} does not echo the raw error message`, async () => {
      c.reader.mockImplementationOnce(async () => {
        throw new Error('secret-internal-host.example failed')
      })
      const res = await c.handler({
        request: new Request(`http://x${c.url}&limit=5`),
      })
      expect(res.status).toBe(500)
      expect(await res.text()).not.toContain('secret-internal-host')
    })
  }
})
