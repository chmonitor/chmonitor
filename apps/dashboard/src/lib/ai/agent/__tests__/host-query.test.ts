/**
 * The agent's host binding: a signed-in user's own connection (negative host
 * id) must be the ONLY thing the agent's tools query for that request.
 *
 * Why each case matters:
 * - before this, a negative id was clamped to host 0, so the agent answered
 *   from the hidden demo host — wrong data, silently;
 * - every user's first saved connection is host -1000, so anything keyed by
 *   host id alone (the metadata cache) would leak one user's results to
 *   another;
 * - the model can pass `hostId: 0` to any tool; on a user connection that
 *   must fail, not reach the demo host;
 * - the connection path must stay read-only, at the same level (2) and with
 *   the same `max_execution_time` default the env client sends.
 */

import type { ConnectionStore } from '@/lib/connection-store/types'

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realClient from '@chm/clickhouse-client'

const fetchData = mock(async (_opts: Record<string, unknown>) => ({
  data: [{ source: 'env' }],
  error: null,
}))
mock.module('@chm/clickhouse-client', () => ({ ...realClient, fetchData }))

type QueryCall = {
  host: string
  query: string
  clickhouse_settings?: Record<string, unknown>
}
const connectionCalls: QueryCall[] = []
mock.module('@/lib/connection-query/connection-client', () => ({
  createConnectionClient: (creds: { host: string }) => ({
    query: async (args: Omit<QueryCall, 'host'>) => {
      connectionCalls.push({ host: creds.host, ...args })
      return { json: async () => [{ source: creds.host }] }
    },
    close: async () => {},
  }),
}))

const {
  resolveAgentConnection,
  runWithAgentConnection,
  connectionReadOnlyQuery,
} = await import('../host-query')
const { readOnlyQuery, validatedReadOnlyQuery, writeQuery, metadataCache } =
  await import('../tools/helpers')
const { createAllTools, CONNECTION_UNSUPPORTED_TOOLS } = await import(
  '../tools'
)

/** Two users, each with their own connection at the same host id -1000. */
const CONNECTIONS = [
  {
    id: 'conn-a',
    userId: 'user_a',
    hostId: -1000,
    engine: 'clickhouse',
    host: 'https://a.example.com',
  },
  {
    id: 'conn-b',
    userId: 'user_b',
    hostId: -1000,
    engine: 'clickhouse',
    host: 'https://b.example.com',
  },
  {
    id: 'conn-pg',
    userId: 'user_a',
    hostId: -1001,
    engine: 'postgres',
    host: 'pg.example.com',
  },
]

const store = {
  list: async (userId: string) =>
    CONNECTIONS.filter((c) => c.userId === userId).map((c) => ({
      id: c.id,
      userId: c.userId,
      name: c.id,
      hostUrl: c.host,
      chUser: 'default',
      hostId: c.hostId,
      engine: c.engine,
      createdAt: 0,
      updatedAt: 0,
    })),
  getCredentials: async (userId: string, id: string) => {
    const c = CONNECTIONS.find((x) => x.id === id && x.userId === userId)
    return c ? { host: c.host, user: 'default', password: 'pw' } : null
  },
} as unknown as ConnectionStore

const deps = { storageEnabled: () => true, loadStore: async () => store }

async function bindingFor(userId: string, hostId = -1000) {
  const r = await resolveAgentConnection({ hostId, userId }, deps)
  if (!r.ok) throw new Error(`expected a binding, got ${r.reason}`)
  return r.binding
}

type Exec = (input: unknown, options?: unknown) => Promise<unknown>
function execOf(tools: Record<string, unknown>, name: string): Exec {
  return (tools[name] as { execute: Exec }).execute
}

beforeEach(() => {
  fetchData.mockClear()
  connectionCalls.length = 0
  metadataCache.clear()
})

describe('resolveAgentConnection', () => {
  test("resolves the caller's own ClickHouse connection", async () => {
    const binding = await bindingFor('user_a')
    expect(binding.connectionId).toBe('conn-a')
    expect(binding.credentials.host).toBe('https://a.example.com')
  })

  test("never resolves another user's connection (not_found)", async () => {
    const r = await resolveAgentConnection(
      { hostId: -1001, userId: 'user_b' },
      deps
    )
    expect(r).toEqual({ ok: false, reason: 'not_found' })
  })

  test('refuses Postgres, browser-stored ids and disabled storage', async () => {
    expect(
      await resolveAgentConnection({ hostId: -1001, userId: 'user_a' }, deps)
    ).toEqual({ ok: false, reason: 'unsupported_engine' })
    expect(
      await resolveAgentConnection({ hostId: -1, userId: 'user_a' }, deps)
    ).toEqual({ ok: false, reason: 'browser_connection' })
    expect(
      await resolveAgentConnection(
        { hostId: -1000, userId: 'user_a' },
        { ...deps, storageEnabled: () => false }
      )
    ).toEqual({ ok: false, reason: 'storage_disabled' })
  })
})

describe('readOnlyQuery dispatch', () => {
  test('env host ids still go through fetchData with readonly', async () => {
    const rows = await readOnlyQuery({ query: 'SELECT 1', hostId: 0 })
    expect(rows).toEqual([{ source: 'env' }])
    expect(fetchData).toHaveBeenCalledTimes(1)
    const call = fetchData.mock.calls[0][0] as {
      clickhouse_settings: Record<string, unknown>
    }
    expect(call.clickhouse_settings.readonly).toBe('1')
    expect(connectionCalls).toHaveLength(0)
  })

  test('a bound call runs on the connection with readonly forced', async () => {
    const binding = await bindingFor('user_a')
    const rows = await runWithAgentConnection(binding, () =>
      readOnlyQuery({
        query: 'SELECT 1',
        hostId: -1000,
        // A caller cannot turn readonly off.
        clickhouse_settings: { max_execution_time: 5, readonly: '0' } as {
          max_execution_time: number
        },
      })
    )
    expect(rows).toEqual([{ source: 'https://a.example.com' }])
    expect(fetchData).not.toHaveBeenCalled()
    expect(connectionCalls[0].clickhouse_settings).toEqual({
      max_execution_time: 5,
      readonly: '2',
    })
    expect(connectionCalls[0].query).toContain('SELECT 1')
  })

  test('a bound call gets the default max_execution_time, like the env client', async () => {
    const binding = await bindingFor('user_a')
    await runWithAgentConnection(binding, () =>
      readOnlyQuery({ query: 'SELECT 1', hostId: -1000 })
    )
    expect(connectionCalls[0].clickhouse_settings).toEqual({
      max_execution_time: 60,
      readonly: '2',
    })
  })

  test('a bound call cannot target another host (no hostId: 0 to the demo)', async () => {
    const binding = await bindingFor('user_a')
    await expect(
      runWithAgentConnection(binding, () =>
        readOnlyQuery({ query: 'SELECT 1', hostId: 0 })
      )
    ).rejects.toThrow(/not available here/)
    expect(fetchData).not.toHaveBeenCalled()
    expect(connectionCalls).toHaveLength(0)
  })

  test('a negative id with no binding never reaches fetchData', async () => {
    await expect(
      readOnlyQuery({ query: 'SELECT 1', hostId: -1000 })
    ).rejects.toThrow(/not bound/)
    expect(fetchData).not.toHaveBeenCalled()
  })

  test('two users on host -1000 never share cached results', async () => {
    const a = await bindingFor('user_a')
    const b = await bindingFor('user_b')
    const q = { query: 'SELECT name FROM system.tables', hostId: -1000 }
    const rowsA = await runWithAgentConnection(a, () =>
      readOnlyQuery({ ...q, useCache: true })
    )
    const rowsB = await runWithAgentConnection(b, () =>
      readOnlyQuery({ ...q, useCache: true })
    )
    expect(rowsA).toEqual([{ source: 'https://a.example.com' }])
    expect(rowsB).toEqual([{ source: 'https://b.example.com' }])
  })

  test('validated SQL is still validated before reaching the connection', async () => {
    const binding = await bindingFor('user_a')
    await expect(
      runWithAgentConnection(binding, () =>
        validatedReadOnlyQuery({ sql: 'DROP TABLE t', hostId: -1000 })
      )
    ).rejects.toThrow(/Validation error/)
    expect(connectionCalls).toHaveLength(0)
  })

  test('writes never run on a user connection', async () => {
    const binding = await bindingFor('user_a')
    await expect(
      runWithAgentConnection(binding, () =>
        writeQuery({ query: 'KILL QUERY WHERE 1', hostId: -1000 })
      )
    ).rejects.toThrow(/not available/)
    expect(fetchData).not.toHaveBeenCalled()
    expect(connectionCalls).toHaveLength(0)
  })

  test('connectionReadOnlyQuery keeps the format result as returned', async () => {
    const binding = await bindingFor('user_b')
    const rows = await connectionReadOnlyQuery(binding, { query: 'SELECT 1' })
    expect(rows).toEqual([{ source: 'https://b.example.com' }])
  })
})

describe('createAllTools bound to a user connection', () => {
  test('the query tool runs on the connection, not on env host 0', async () => {
    const binding = await bindingFor('user_a')
    const tools = createAllTools(-1000, false, binding)
    await execOf(tools, 'query')({ sql: 'SELECT 1' })
    expect(fetchData).not.toHaveBeenCalled()
    expect(connectionCalls).toHaveLength(1)
    expect(connectionCalls[0].host).toBe('https://a.example.com')
  })

  test('a model-supplied hostId override is refused', async () => {
    const binding = await bindingFor('user_a')
    const tools = createAllTools(-1000, false, binding)
    await expect(
      execOf(tools, 'list_databases')({ hostId: 0 })
    ).rejects.toThrow(/not available here/)
    expect(fetchData).not.toHaveBeenCalled()
  })

  test('host-keyed tools return a clear error instead of running', async () => {
    const binding = await bindingFor('user_a')
    const tools = createAllTools(-1000, false, binding)
    for (const name of ['explain_anomaly_score', 'generate_cluster_report']) {
      expect(CONNECTION_UNSUPPORTED_TOOLS.has(name)).toBe(true)
      await expect(execOf(tools, name)({})).rejects.toThrow(
        /not available on your own connections/
      )
    }
    expect(fetchData).not.toHaveBeenCalled()
  })

  test('the tool set is identical with or without a binding', async () => {
    const binding = await bindingFor('user_a')
    expect(Object.keys(createAllTools(-1000, false, binding)).sort()).toEqual(
      Object.keys(createAllTools(0, false)).sort()
    )
  })

  test('a binding for a different host id is a programming error', async () => {
    const binding = await bindingFor('user_a')
    expect(() => createAllTools(0, false, binding)).toThrow()
  })
})
