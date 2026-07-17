import { describe, expect, mock, test } from 'bun:test'

// Mock fetchData before importing the tool
const mockFetchData = mock(() => Promise.resolve({ data: [], error: null }))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

import { registerQueryTools } from '../queries'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod/v3'

/** Helper to get the registered tool handler */
function getToolHandler(server: McpServer, name: string) {
  const tools = (server as any)._registeredTools
  const tool = tools?.[name]
  if (!tool?.handler) throw new Error(`Tool "${name}" not found`)
  return (args: Record<string, unknown>) => tool.handler(args, {})
}

describe('registerQueryTools', () => {
  test('registers without errors', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    expect(() => registerQueryTools(server)).not.toThrow()
  })
})

describe('get_running_queries limit param (#2705)', () => {
  test('appends LIMIT {limit:UInt32} to the SQL and forwards limit via query_params', async () => {
    const calls: any[] = []
    mockFetchData.mockImplementation(async (params: any) => {
      calls.push(params)
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerQueryTools(server)
    const call = getToolHandler(server, 'get_running_queries')

    // Explicit limit
    await call({ limit: 5, hostId: 0 })

    expect(calls).toHaveLength(1)
    expect(calls[0].query).toContain('LIMIT {limit:UInt32}')
    expect(calls[0].query_params).toEqual({ limit: 5 })
  })

  test('forwards the schema-resolved default limit (50) via query_params', async () => {
    const calls: any[] = []
    mockFetchData.mockImplementation(async (params: any) => {
      calls.push(params)
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerQueryTools(server)
    const call = getToolHandler(server, 'get_running_queries')

    // The MCP SDK resolves the zod `.default(50)` before invoking the
    // handler; simulate that resolved value since this test calls the
    // handler directly (bypassing the SDK's request-dispatch layer).
    await call({ limit: 50 })

    expect(calls[0].query_params).toEqual({ limit: 50 })
  })
})

describe('get_running_queries limit schema (#2705)', () => {
  // Mirrors the zod shape registered for `limit` in ../queries.ts
  const limitSchema = z.number().int().min(1).max(1000).default(50)

  test('defaults to 50 when omitted', () => {
    expect(limitSchema.parse(undefined)).toBe(50)
  })

  test('accepts an explicit in-range value', () => {
    expect(limitSchema.parse(5)).toBe(5)
  })

  test('rejects values above the hard max of 1000', () => {
    expect(() => limitSchema.parse(5000)).toThrow()
  })

  test('rejects values below the min of 1', () => {
    expect(() => limitSchema.parse(0)).toThrow()
  })
})
