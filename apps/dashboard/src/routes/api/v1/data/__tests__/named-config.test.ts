/**
 * POST /api/v1/data with `queryConfigName` runs only the SQL of that
 * registered QueryConfig. The per-feature permission check uses the named
 * config, so the SQL that runs must be the config's own — never a
 * client-supplied string.
 *
 * Uses the real `query-detail` config (versioned SQL + `queries` permission)
 * and the real executeTableConfig; only the ClickHouse transport, the version
 * lookup, and the permission gate are stubbed.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import * as realClient from '@chm/clickhouse-client'
import * as realVersion from '@chm/clickhouse-client/clickhouse-version'

mock.module('cloudflare:workers', () => ({ env: {} }))

mock.module('@/lib/cloud/reject-demo-host', () => ({
  demoHiddenUnavailable: () => ({ reason: 'demo_hidden' }),
  isDemoHostBlockedForRequest: async () => false,
}))

let serverVersion = '24.8.1.1'
mock.module('@chm/clickhouse-client/clickhouse-version', () => ({
  ...realVersion,
  getClickHouseVersion: async () => realVersion.parseVersion(serverVersion),
}))

const fetchCalls: Array<Record<string, any>> = []
mock.module('@chm/clickhouse-client', () => ({
  ...realClient,
  fetchData: async (params: Record<string, any>) => {
    fetchCalls.push(params)
    return { data: [], error: undefined, metadata: { rows: 0 } }
  },
}))

let permissionResponse: Response | null = null
const permissionCalls: unknown[] = []
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async (permission: unknown) => {
    permissionCalls.push(permission)
    return permissionResponse
  },
}))

const { Route } = await import('@/routes/api/v1/data')
const { getTableConfig } = await import('@/lib/api/table-registry')

const post = (Route as any).options.server.handlers.POST as (ctx: {
  request: Request
}) => Promise<Response>

function send(body: Record<string, unknown>) {
  return post({
    request: new Request('http://x/api/v1/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
}

afterEach(() => {
  fetchCalls.length = 0
  permissionCalls.length = 0
  permissionResponse = null
  serverVersion = '24.8.1.1'
})

describe('POST /api/v1/data with queryConfigName', () => {
  test('runs the config SQL with body params bound as query_params', async () => {
    const res = await send({
      queryConfigName: 'query-detail',
      queryParams: { query_id: 'abc' },
      hostId: 0,
    })
    expect(res.status).toBe(200)
    expect(fetchCalls).toHaveLength(1)
    const config = getTableConfig('query-detail')!
    const expected = realVersion.selectVersionedSql(
      config.sql as any,
      realVersion.parseVersion(serverVersion)
    )
    expect(fetchCalls[0].query).toBe(expected)
    expect(fetchCalls[0].query_params).toMatchObject({ query_id: 'abc' })
  })

  test('rejects a body that also carries SQL, without running anything', async () => {
    const res = await send({
      queryConfigName: 'query-detail',
      query: 'SELECT 1',
      hostId: 0,
    })
    expect(res.status).toBe(400)
    expect(fetchCalls).toHaveLength(0)
  })

  test('unknown config is a 404', async () => {
    const res = await send({ queryConfigName: 'no-such-config', hostId: 0 })
    expect(res.status).toBe(404)
    expect(fetchCalls).toHaveLength(0)
  })

  test("enforces the named config's feature permission", async () => {
    permissionResponse = Response.json({ error: 'no' }, { status: 401 })
    const res = await send({ queryConfigName: 'query-detail', hostId: 0 })
    expect(res.status).toBe(401)
    expect(permissionCalls).toEqual([
      getTableConfig('query-detail')!.permission,
    ])
    expect(fetchCalls).toHaveLength(0)
  })

  test('picks the versioned SQL for the server version', async () => {
    const config = getTableConfig('query-detail')!
    const versions = config.sql as Array<{ since: string; sql: string }>
    const executed: string[] = []
    for (const v of [versions[0].since, versions.at(-1)!.since]) {
      serverVersion = `${v}.1.1`
      await send({ queryConfigName: 'query-detail', hostId: 0 })
      executed.push(fetchCalls.at(-1)!.query)
    }
    expect(executed[0]).toBe(versions[0].sql)
    expect(executed[1]).toBe(versions.at(-1)!.sql)
    expect(executed[0]).not.toBe(executed[1])
  })

  test('invalid hostId is a 400', async () => {
    const res = await send({ queryConfigName: 'query-detail', hostId: 'x' })
    expect(res.status).toBe(400)
  })
})
