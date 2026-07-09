import { describe, expect, mock, test } from 'bun:test'

// Mock fetchData before importing the tool
const mockFetchData = mock(() => Promise.resolve({ data: [], error: null }))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

import { registerQueryTool } from '../tools/query'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/** Helper to get the registered tool handler */
function getToolHandler(server: McpServer, name: string) {
  const tools = (server as any)._registeredTools
  const tool = tools?.[name]
  if (!tool?.handler) throw new Error(`Tool "${name}" not found`)
  return (args: Record<string, unknown>) => tool.handler(args, {})
}

describe('registerQueryTool', () => {
  test('registers without errors', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    expect(() => registerQueryTool(server)).not.toThrow()
  })

  test('returns rows unchanged and truncated: false when at or under the cap', async () => {
    mockFetchData.mockResolvedValue({
      data: Array.from({ length: 10 }, (_, i) => ({ id: i })),
      error: null,
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerQueryTool(server)
    const call = getToolHandler(server, 'query')

    const result = await call({ sql: 'SELECT id FROM small_table' })
    const payload = JSON.parse(result.content[0].text)

    expect(payload.data).toHaveLength(10)
    expect(payload.truncated).toBe(false)
    expect(payload.note).toBeUndefined()
  })

  test('caps results at 1000 rows and includes a truncation note', async () => {
    mockFetchData.mockResolvedValue({
      data: Array.from({ length: 1500 }, (_, i) => ({ id: i })),
      error: null,
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerQueryTool(server)
    const call = getToolHandler(server, 'query')

    const result = await call({ sql: 'SELECT id FROM big_table' })
    const payload = JSON.parse(result.content[0].text)

    expect(payload.data).toHaveLength(1000)
    expect(payload.truncated).toBe(true)
    expect(payload.note).toContain('truncated to 1000 rows')
  })

  test('rejects non-SELECT SQL before running the query', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerQueryTool(server)
    const call = getToolHandler(server, 'query')

    const result = await call({ sql: 'DROP TABLE big_table' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Validation error')
  })

  test('surfaces ClickHouse errors without touching the cap logic', async () => {
    mockFetchData.mockResolvedValue({
      data: null,
      error: new Error('Connection refused'),
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerQueryTool(server)
    const call = getToolHandler(server, 'query')

    const result = await call({ sql: 'SELECT 1' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Connection refused')
  })
})
