import { describe, expect, mock, test } from 'bun:test'

// Mock fetchData before importing the tool
const mockFetchData = mock(() => Promise.resolve({ data: [], error: null }))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

import { registerExploreTableSchemaTool } from '../tools/explore-table-schema'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/** Helper to get the registered tool handler */
function getToolHandler(server: McpServer, name: string) {
  const tools = (server as any)._registeredTools
  const tool = tools?.[name]
  if (!tool?.handler) throw new Error(`Tool "${name}" not found`)
  return (args: Record<string, unknown>) => tool.handler(args, {})
}

describe('registerExploreTableSchemaTool', () => {
  test('registers without errors', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    expect(() => registerExploreTableSchemaTool(server)).not.toThrow()
  })

  describe('mode 1: no params — list databases', () => {
    test('returns rows unchanged and truncated: false when at or under the cap', async () => {
      mockFetchData.mockResolvedValue({
        data: Array.from({ length: 10 }, (_, i) => ({ name: `db_${i}` })),
        error: null,
      })

      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerExploreTableSchemaTool(server)
      const call = getToolHandler(server, 'explore_table_schema')

      const result = await call({})
      const payload = JSON.parse(result.content[0].text)

      expect(payload.data).toHaveLength(10)
      expect(payload.truncated).toBe(false)
      expect(payload.note).toBeUndefined()
    })

    test('caps results at 1000 rows and includes a truncation note', async () => {
      mockFetchData.mockResolvedValue({
        data: Array.from({ length: 1500 }, (_, i) => ({ name: `db_${i}` })),
        error: null,
      })

      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerExploreTableSchemaTool(server)
      const call = getToolHandler(server, 'explore_table_schema')

      const result = await call({})
      const payload = JSON.parse(result.content[0].text)

      expect(payload.data).toHaveLength(1000)
      expect(payload.truncated).toBe(true)
      expect(payload.note).toContain('truncated to 1000 rows')
    })

    test('surfaces ClickHouse errors', async () => {
      mockFetchData.mockResolvedValue({
        data: null,
        error: new Error('Connection refused'),
      })

      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerExploreTableSchemaTool(server)
      const call = getToolHandler(server, 'explore_table_schema')

      const result = await call({})

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Connection refused')
    })
  })

  describe('mode 2: database only — list tables', () => {
    test('returns rows unchanged and truncated: false when at or under the cap', async () => {
      mockFetchData.mockResolvedValue({
        data: Array.from({ length: 10 }, (_, i) => ({ name: `table_${i}` })),
        error: null,
      })

      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerExploreTableSchemaTool(server)
      const call = getToolHandler(server, 'explore_table_schema')

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
      registerExploreTableSchemaTool(server)
      const call = getToolHandler(server, 'explore_table_schema')

      const result = await call({ database: 'default' })
      const payload = JSON.parse(result.content[0].text)

      expect(payload.data).toHaveLength(1000)
      expect(payload.truncated).toBe(true)
      expect(payload.note).toContain('truncated to 1000 rows')
    })
  })

  describe('mode 3: database + table — full schema', () => {
    test('leaves columns/dependencies untouched and truncated: false when under the cap', async () => {
      mockFetchData
        .mockResolvedValueOnce({
          data: [{ database: 'default', name: 'events', engine: 'MergeTree' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: Array.from({ length: 10 }, (_, i) => ({ name: `col_${i}` })),
          error: null,
        })
        .mockResolvedValueOnce({
          data: Array.from({ length: 5 }, (_, i) => ({ dep_table: `up_${i}` })),
          error: null,
        })
        .mockResolvedValueOnce({
          data: Array.from({ length: 5 }, (_, i) => ({
            dependent_table: `down_${i}`,
          })),
          error: null,
        })

      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerExploreTableSchemaTool(server)
      const call = getToolHandler(server, 'explore_table_schema')

      const result = await call({ database: 'default', table: 'events' })
      const payload = JSON.parse(result.content[0].text)

      expect(payload.columns).toHaveLength(10)
      expect(payload.upstream_dependencies).toHaveLength(5)
      expect(payload.downstream_dependencies).toHaveLength(5)
      expect(payload.truncated).toBe(false)
      expect(payload.note).toBeUndefined()
    })

    test('caps columns at 1000 rows and includes a truncation note', async () => {
      mockFetchData
        .mockResolvedValueOnce({
          data: [{ database: 'default', name: 'events', engine: 'MergeTree' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: Array.from({ length: 1500 }, (_, i) => ({ name: `col_${i}` })),
          error: null,
        })
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null })

      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerExploreTableSchemaTool(server)
      const call = getToolHandler(server, 'explore_table_schema')

      const result = await call({ database: 'default', table: 'events' })
      const payload = JSON.parse(result.content[0].text)

      expect(payload.columns).toHaveLength(1000)
      expect(payload.truncated).toBe(true)
      expect(payload.note).toContain('truncated to 1000 rows')
    })

    test('surfaces ClickHouse errors from any of the parallel queries', async () => {
      mockFetchData
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({
          data: null,
          error: new Error('Connection refused'),
        })
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null })

      const server = new McpServer({ name: 'test', version: '0.0.1' })
      registerExploreTableSchemaTool(server)
      const call = getToolHandler(server, 'explore_table_schema')

      const result = await call({ database: 'default', table: 'events' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Connection refused')
    })
  })
})
