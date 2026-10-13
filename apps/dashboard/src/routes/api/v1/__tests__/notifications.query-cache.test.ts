/**
 * WHY: GET /api/v1/notifications is polled every 30s by every open tab. Its
 * replica-count queries must run under the ClickHouse query cache (like
 * host-status.ts) so N tabs cost one query per TTL, not N. Both the
 * cluster-wide and the node-local fallback query are covered.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realVersion from '@chm/clickhouse-client/clickhouse-version'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

mock.module('@/lib/cloud/reject-demo-host', () => ({
  isDemoHostBlockedForRequest: async () => false,
}))

mock.module('@chm/clickhouse-client/clickhouse-version', () => ({
  ...realVersion,
  getClickHouseVersion: async () => realVersion.parseVersion('24.8.1.1'),
}))

type QueryArgs = {
  query: string
  clickhouse_settings?: Record<string, unknown>
}
const queries: QueryArgs[] = []

mock.module('@chm/clickhouse-client', () => ({
  getClient: async () => ({
    query: async (args: QueryArgs) => {
      queries.push(args)
      return { json: async () => [{ count: 1 }] }
    },
  }),
  fetchData: async () => ({ data: [], metadata: {}, error: undefined }),
}))

let fanout: {
  status: string
  cluster: string | null
  nextProbeAt: number
} = { status: 'supported', cluster: 'default', nextProbeAt: 0 }

mock.module('@/lib/health/cluster-fanout', () => ({
  getClusterFanout: async () => fanout,
  clusterViewNotice: () => null,
}))

type GetHandler = (ctx: { request: Request }) => Promise<Response>
const { Route } = await import('../notifications')
const handler = (
  Route.options.server as unknown as { handlers: { GET: GetHandler } }
).handlers.GET

const get = () =>
  handler({ request: new Request('http://x/api/v1/notifications?hostId=0') })

describe('GET /api/v1/notifications query cache', () => {
  beforeEach(() => {
    queries.length = 0
  })

  test('cluster-wide replica count runs with the query cache enabled', async () => {
    fanout = { status: 'supported', cluster: 'default', nextProbeAt: 0 }
    const res = await get()
    expect(res.status).toBe(200)
    expect(queries).toHaveLength(1)
    expect(queries[0].query).toContain('clusterAllReplicas')
    expect(queries[0].clickhouse_settings).toMatchObject({
      use_query_cache: 1,
      query_cache_ttl: 30,
    })
  })

  test('node-local fallback replica count runs with the query cache enabled', async () => {
    fanout = { status: 'unsupported', cluster: null, nextProbeAt: 0 }
    const res = await get()
    expect(res.status).toBe(200)
    expect(queries).toHaveLength(1)
    expect(queries[0].query).not.toContain('clusterAllReplicas')
    expect(queries[0].clickhouse_settings).toMatchObject({
      use_query_cache: 1,
      query_cache_ttl: 30,
    })
  })
})
