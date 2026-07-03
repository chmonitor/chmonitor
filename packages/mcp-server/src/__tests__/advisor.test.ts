import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const calls: Array<{ query: string; hostId?: number }> = []

function respond(query: string): { data: unknown[]; error: null } {
  const q = query.toLowerCase()
  if (q.includes('system.query_log')) {
    return {
      data: [{ query: "SELECT * FROM default.events WHERE status = 'error'" }],
      error: null,
    }
  }
  if (q.includes('system.tables')) {
    return {
      data: [
        { partition_key: 'event_date', sorting_key: 'event_date, user_id' },
      ],
      error: null,
    }
  }
  if (q.includes('system.columns')) {
    return {
      data: [
        {
          name: 'status',
          type: 'String',
          is_in_partition_key: 0,
          is_in_sorting_key: 0,
          data_compressed_bytes: 1000,
          data_uncompressed_bytes: 2000,
        },
      ],
      error: null,
    }
  }
  if (q.includes('system.data_skipping_indexes'))
    return { data: [], error: null }
  if (q.includes('system.parts')) {
    return {
      data: [
        {
          active_parts: 5,
          total_rows: 1000,
          total_bytes: 100000,
          total_granules: 1000,
        },
      ],
      error: null,
    }
  }
  if (q.includes('explain plan indexes')) {
    return {
      data: [
        { explain: 'PrimaryKey' },
        { explain: 'Parts: 5/5' },
        { explain: 'Granules: 900/1000' },
      ],
      error: null,
    }
  }
  if (q.includes('explain estimate'))
    return { data: [{ marks: 900 }], error: null }
  return { data: [], error: null }
}

const mockFetchData = mock(
  async (params: { query: string; hostId?: number }) => {
    calls.push({ query: params.query, hostId: params.hostId })
    return respond(params.query)
  }
)

mock.module('@chm/clickhouse-client', () => ({ fetchData: mockFetchData }))

const { registerAdvisorTool } = await import('../tools/advisor')
const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')

function getToolHandler(server: InstanceType<typeof McpServer>, name: string) {
  const tools = (server as any)._registeredTools
  const tool = tools?.[name]
  if (!tool?.handler) throw new Error(`Tool "${name}" not found`)
  return (args: Record<string, unknown>) => tool.handler(args, {})
}

describe('registerAdvisorTool', () => {
  test('registers without errors', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    expect(() => registerAdvisorTool(server)).not.toThrow()
  })

  test('returns ranked recommendations for a raw sql query', async () => {
    calls.length = 0
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerAdvisorTool(server)
    const call = getToolHandler(server, 'get_optimization_recommendations')

    const result = await call({
      sql: "SELECT * FROM default.events WHERE status = 'error'",
    })
    const body = JSON.parse(result.content[0].text)

    expect(body.ok).toBe(true)
    expect(Array.isArray(body.recommendations)).toBe(true)
    expect(body.recommendations.length).toBeGreaterThan(0)
  })

  test('resolves a query_id via system.query_log', async () => {
    calls.length = 0
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerAdvisorTool(server)
    const call = getToolHandler(server, 'get_optimization_recommendations')

    const result = await call({ queryId: 'abc' })
    const body = JSON.parse(result.content[0].text)
    expect(body.ok).toBe(true)
  })

  test('returns an error result when neither sql nor queryId is given', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerAdvisorTool(server)
    const call = getToolHandler(server, 'get_optimization_recommendations')

    const result = await call({})
    expect(result.isError).toBe(true)
  })

  test('recommend-only: every query issued is read-only, and the file has no execute/write surface', async () => {
    calls.length = 0
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerAdvisorTool(server)
    const call = getToolHandler(server, 'get_optimization_recommendations')
    await call({ sql: "SELECT * FROM default.events WHERE status = 'error'" })

    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) {
      const trimmed = c.query.trim().toUpperCase()
      expect(trimmed).toMatch(/^(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE)\b/)
      expect(
        /\b(ALTER|CREATE|INSERT|DROP|TRUNCATE|RENAME|DELETE|UPDATE)\b/i.test(
          c.query
        )
      ).toBe(false)
    }

    const source = readFileSync(
      join(import.meta.dir, '..', 'tools', 'advisor.ts'),
      'utf-8'
    )
    expect(source).not.toMatch(/\.command\s*\(/)
    expect(source).not.toMatch(/\.insert\s*\(/)
  })
})
