import { describe, expect, mock, test } from 'bun:test'

// Mock fetchData before importing the tool
const mockFetchData = mock(() => Promise.resolve({ data: [], error: null }))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

import { registerTableTools } from '../tools/tables'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/** Helper to get the registered tool handler */
function getToolHandler(server: McpServer, name: string) {
  const tools = (server as any)._registeredTools
  const tool = tools?.[name]
  if (!tool?.handler) throw new Error(`Tool "${name}" not found`)
  return (args: Record<string, unknown>) => tool.handler(args, {})
}

describe('registerTableTools', () => {
  test('registers without errors', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    expect(() => registerTableTools(server)).not.toThrow()
  })

  describe('list_tables', () => {
    test('returns rows unchanged and truncated: false when at or under the cap', async () => {
      mockFetchData.mockResolvedValue({
        data: Array.from({ length: 10 }, (_, i) => ({ name: `table_${i}` })),
        error: null,
      })

      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerTableTools(server)
      const call = getToolHandler(server, 'list_tables')

      const result = await call({ database: 'default' })
      const payload = JSON.parse(result.content[0].text)

      expect(payload.data).toHaveLength(10)
      expect(payload.truncated).toBe(false)
      expect(payload.note).toBeUndefined()
    })

    test('caps results at 1000 rows and includes a truncation note', async () => {
      mockFetchData.mockResolvedValue({
        data: Array.from({ length: 1500 }, (_, i) => ({ name: `table_${i}` })),
        error: null,
      })

      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerTableTools(server)
      const call = getToolHandler(server, 'list_tables')

      const result = await call({ database: 'default' })
      const payload = JSON.parse(result.content[0].text)

      expect(payload.data).toHaveLength(1000)
      expect(payload.truncated).toBe(true)
      expect(payload.note).toContain('truncated to 1000 rows')
    })

    test('surfaces ClickHouse errors without touching the cap logic', async () => {
      mockFetchData.mockResolvedValue({
        data: null,
        error: new Error('Connection refused'),
      })

      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerTableTools(server)
      const call = getToolHandler(server, 'list_tables')

      const result = await call({ database: 'default' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Connection refused')
    })
  })
})
