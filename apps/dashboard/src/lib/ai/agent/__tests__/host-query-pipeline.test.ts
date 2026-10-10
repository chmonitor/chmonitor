// @ts-nocheck — AI SDK generics (ToolLoopAgent / MockLanguageModelV3) are not
// worth fighting in test code; same convention as scenarios.test.ts.
/**
 * The connection binding must survive the REAL agent pipeline
 * (`createClickHouseAgent` → filterTools → withCachedInputSchemas →
 * wrapToolsWithLogging → the AI SDK tool loop), and must not leak between two
 * agents built for two users whose connections share host id -1000.
 *
 * Also covers the two tools that bypass `readOnlyQuery` and run dashboard
 * query configs (`list_slow_query_patterns`, `get_page_data`): on a user
 * connection they must use the connection executors, never the env
 * `query-executor` (which would resolve the host id against env hosts).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'
import * as realClient from '@chm/clickhouse-client'
import { MockLanguageModelV3 } from 'ai/test'

const fetchData = mock(async () => ({ data: [{ host: 'env' }], error: null }))
mock.module('@chm/clickhouse-client', () => ({ ...realClient, fetchData }))

const connectionQueries: string[] = []
mock.module('@/lib/connection-query/connection-client', () => ({
  createConnectionClient: (creds: { host: string }) => ({
    query: async () => {
      connectionQueries.push(creds.host)
      return { json: async () => [{ host: creds.host }] }
    },
    close: async () => {},
  }),
}))

const connectionTable = mock(
  async (_config: unknown, creds: { host: string }) => ({
    data: [{ host: creds.host }],
    metadata: {},
    executedSql: '',
  })
)
mock.module('@/lib/connection-query/execute-connection-table', () => ({
  executeConnectionTableConfig: connectionTable,
}))
const connectionChart = mock(
  async (_name: string, creds: { host: string }) => ({
    data: [{ host: creds.host }],
    metadata: {},
    executedSql: '',
  })
)
mock.module('@/lib/connection-query/execute-connection-chart', () => ({
  executeConnectionChartQuery: connectionChart,
}))

const envExecutor = mock(async () => {
  throw new Error('env query-executor must not run on a user connection')
})
mock.module('@/lib/api/query-executor', () => ({
  executeTableConfig: envExecutor,
  executeChartQuery: envExecutor,
  executeMultiChartQuery: envExecutor,
}))

const { createClickHouseAgent } = await import('../clickhouse-agent')
const { createAllTools } = await import('../tools')

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

function binding(userId: string, host: string) {
  return {
    hostId: -1000,
    userId,
    connectionId: `${userId}-conn`,
    credentials: { host, user: 'default', password: '' },
  }
}

async function runQueryTurn(conn: ReturnType<typeof binding>) {
  const model = new MockLanguageModelV3({
    doGenerate: [
      {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_query',
            toolName: 'query',
            input: JSON.stringify({ sql: 'SELECT 1' }),
          },
        ],
        finishReason: 'tool-calls',
        usage: USAGE,
        warnings: [],
      },
      {
        content: [{ type: 'text', text: 'done' }],
        finishReason: 'stop',
        usage: USAGE,
        warnings: [],
      },
    ],
  })
  const agent = createClickHouseAgent({
    hostId: -1000,
    connection: conn,
    model,
  })
  return agent.generate({ prompt: 'how many rows?' })
}

beforeEach(() => {
  fetchData.mockClear()
  envExecutor.mockClear()
  connectionTable.mockClear()
  connectionChart.mockClear()
  connectionQueries.length = 0
})

describe('connection binding through the real agent', () => {
  test('two users on host -1000 each reach only their own connection', async () => {
    const a = await runQueryTurn(binding('user_a', 'https://a.example.com'))
    const b = await runQueryTurn(binding('user_b', 'https://b.example.com'))

    expect(a.toolResults[0].toolName).toBe('query')
    expect(JSON.stringify(a.toolResults[0].output)).toContain(
      'https://a.example.com'
    )
    expect(JSON.stringify(b.toolResults[0].output)).toContain(
      'https://b.example.com'
    )
    expect(connectionQueries).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
    expect(fetchData).not.toHaveBeenCalled()
  })
})

describe('query-config tools on a user connection', () => {
  type Exec = (input: unknown) => Promise<unknown>
  const tools = () =>
    createAllTools(
      -1000,
      false,
      binding('user_a', 'https://a.example.com')
    ) as Record<string, { execute: Exec }>

  test('list_slow_query_patterns uses the connection table executor', async () => {
    const rows = await tools().list_slow_query_patterns.execute({})
    expect(rows).toEqual([{ host: 'https://a.example.com' }])
    expect(connectionTable).toHaveBeenCalledTimes(1)
    expect(envExecutor).not.toHaveBeenCalled()
  })

  test('get_page_data runs the page sources on the connection', async () => {
    const out = (await tools().get_page_data.execute({ page: '/merges' })) as {
      sources: Array<{ error?: string }>
    }
    expect(out.sources.length).toBeGreaterThan(0)
    expect(
      connectionTable.mock.calls.length + connectionChart.mock.calls.length
    ).toBeGreaterThan(0)
    expect(envExecutor).not.toHaveBeenCalled()
    expect(fetchData).not.toHaveBeenCalled()
  })

  test('get_page_data refuses a hostId override', async () => {
    await expect(
      tools().get_page_data.execute({ page: '/merges', hostId: 0 })
    ).rejects.toThrow(/not available here/)
    expect(envExecutor).not.toHaveBeenCalled()
  })
})
