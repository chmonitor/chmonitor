/**
 * GET /api/v1/tables/$name/filter-options:
 *
 * - A field gated by `since` must not query a column the server lacks: an
 *   older (or unknown) server version gets a 400, and ClickHouse is never hit.
 * - A query failure keeps its classification (403/404/504...) instead of
 *   collapsing to a 500, like tables/$name.ts (#3738).
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

let since: string | undefined
let serverVersion: string | null = '25.8.1.1'

import * as realRegistry from '@/lib/api/table-registry'

mock.module('@/lib/api/table-registry', () => ({
  ...realRegistry,
  getTableConfig: () => ({
    name: 't',
    sql: 'SELECT 1',
    columns: [],
    filterSchema: {
      fields: [
        {
          key: 'agent',
          label: 'Agent',
          type: 'select',
          since,
          dynamicOptions: { table: 'system.query_log', column: 'client_agent' },
        },
      ],
    },
  }),
}))

import * as realVersion from '@chm/clickhouse-client/clickhouse-version'

mock.module('@chm/clickhouse-client/clickhouse-version', () => ({
  ...realVersion,
  getClickHouseVersion: async () =>
    serverVersion === null ? null : { raw: serverVersion },
}))

type FetchResult = {
  data?: unknown[]
  error?: { type: string; message: string }
}
let fetchImpl: () => Promise<FetchResult> = async () => ({
  data: [{ value: 'x', count: 1 }],
})
const fetchData = mock(() => fetchImpl())

import * as realClient from '@chm/clickhouse-client'

mock.module('@chm/clickhouse-client', () => ({ ...realClient, fetchData }))

const { Route } = await import('@/routes/api/v1/tables/$name/filter-options')

type Handler = (ctx: {
  request: Request
  params: { name: string }
}) => Promise<Response>
const GET = (
  Route as unknown as {
    options: { server: { handlers: { GET: Handler } } }
  }
).options.server.handlers.GET

function call() {
  return GET({
    request: new Request(
      'http://x/api/v1/tables/t/filter-options?hostId=0&key=agent'
    ),
    params: { name: 't' },
  })
}

beforeEach(() => {
  since = undefined
  serverVersion = '25.8.1.1'
  fetchImpl = async () => ({ data: [{ value: 'x', count: 1 }] })
  fetchData.mockClear()
})

describe('filter-options version gate', () => {
  test('field newer than the server -> 400, no query', async () => {
    since = '25.8'
    serverVersion = '24.3.1.1'
    const res = await call()
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toContain('not supported on this server')
    expect(fetchData).not.toHaveBeenCalled()
  })

  test('unknown server version -> 400 for a gated field', async () => {
    since = '25.8'
    serverVersion = null
    expect((await call()).status).toBe(400)
    expect(fetchData).not.toHaveBeenCalled()
  })

  test('server new enough -> 200', async () => {
    since = '25.8'
    const res = await call()
    expect(res.status).toBe(200)
    expect(fetchData).toHaveBeenCalledTimes(1)
  })

  test('ungated field -> 200', async () => {
    expect((await call()).status).toBe(200)
  })
})

describe('filter-options error status', () => {
  const cases: Array<[string, number]> = [
    ['permission_error', 403],
    ['table_not_found', 404],
    ['timeout_error', 504],
    ['network_error', 503],
    ['query_error', 500],
  ]
  for (const [type, status] of cases) {
    test(`${type} -> ${status}`, async () => {
      fetchImpl = async () => ({ error: { type, message: 'boom' } })
      expect((await call()).status).toBe(status)
    })
  }
})
