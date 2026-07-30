import { describe, expect, mock, test } from 'bun:test'

// Mock fetchData before importing the tool
const mockFetchData = mock(() => Promise.resolve({ data: [], error: null }))

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
}))

import { registerPerformanceTool } from '../tools/performance'
import { McpServer } from '@modelcontextprotocol/server'

/** Helper to get the registered tool handler */
function getToolHandler(server: McpServer, name: string) {
  const tools = (server as any)._registeredTools
  const tool = tools?.[name]
  if (!tool?.handler) throw new Error(`Tool "${name}" not found`)
  return (args: Record<string, unknown>) => tool.handler(args, {})
}

describe('registerPerformanceTool', () => {
  test('registers without errors', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' })
    expect(() => registerPerformanceTool(server)).not.toThrow()
  })
})

describe('analyze_performance severity classification', () => {
  test('returns OK severity when all data is empty', async () => {
    mockFetchData.mockResolvedValue({ data: [], error: null })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    const result = await call({ hostId: 0, lastHours: 1 })
    const report = JSON.parse(result.content[0].text)

    expect(report.slow_queries.severity).toBe('OK')
    expect(report.high_part_counts.severity).toBe('OK')
    expect(report.merge_backlog.severity).toBe('OK')
    expect(report.memory_pressure.severity).toBe('OK')
    expect(report.disk_utilization.severity).toBe('OK')
    expect(report.errors).toBeUndefined()
  })

  test('returns CRITICAL for slow queries > 60s', async () => {
    mockFetchData.mockImplementation(async ({ query }: any) => {
      if (query.includes('query_log')) {
        return {
          data: [{ query_id: 'q1', query_duration_ms: 65000 }],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    const result = await call({ hostId: 0, lastHours: 1 })
    const report = JSON.parse(result.content[0].text)

    expect(report.slow_queries.severity).toBe('CRITICAL')
  })

  test('returns WARNING for slow queries > 10s', async () => {
    mockFetchData.mockImplementation(async ({ query }: any) => {
      if (query.includes('query_log')) {
        return {
          data: [{ query_id: 'q1', query_duration_ms: 15000 }],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    const result = await call({ hostId: 0, lastHours: 1 })
    const report = JSON.parse(result.content[0].text)

    expect(report.slow_queries.severity).toBe('WARNING')
  })

  test('returns CRITICAL for part count > 10000', async () => {
    mockFetchData.mockImplementation(async ({ query }: any) => {
      if (query.includes('system.parts')) {
        return {
          data: [
            {
              database: 'default',
              table: 'big_table',
              part_count: 15000,
              total_size: '10 GiB',
            },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    const result = await call({ hostId: 0, lastHours: 1 })
    const report = JSON.parse(result.content[0].text)

    expect(report.high_part_counts.severity).toBe('CRITICAL')
  })

  test('returns WARNING for part count > 3000', async () => {
    mockFetchData.mockImplementation(async ({ query }: any) => {
      if (query.includes('system.parts')) {
        return {
          data: [
            {
              database: 'default',
              table: 'medium_table',
              part_count: 5000,
              total_size: '5 GiB',
            },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    const result = await call({ hostId: 0, lastHours: 1 })
    const report = JSON.parse(result.content[0].text)

    expect(report.high_part_counts.severity).toBe('WARNING')
  })

  test('returns CRITICAL for disk free < 10%', async () => {
    mockFetchData.mockImplementation(async ({ query }: any) => {
      if (query.includes('system.disks')) {
        return {
          data: [
            {
              name: 'default',
              path: '/data',
              free: '5 GiB',
              total: '100 GiB',
              free_pct: 5,
            },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    const result = await call({ hostId: 0, lastHours: 1 })
    const report = JSON.parse(result.content[0].text)

    expect(report.disk_utilization.severity).toBe('CRITICAL')
  })

  test('returns WARNING for disk free < 20%', async () => {
    mockFetchData.mockImplementation(async ({ query }: any) => {
      if (query.includes('system.disks')) {
        return {
          data: [
            {
              name: 'default',
              path: '/data',
              free: '15 GiB',
              total: '100 GiB',
              free_pct: 15,
            },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    const result = await call({ hostId: 0, lastHours: 1 })
    const report = JSON.parse(result.content[0].text)

    expect(report.disk_utilization.severity).toBe('WARNING')
  })

  test('returns WARNING for active merges > 20', async () => {
    mockFetchData.mockImplementation(async ({ query }: any) => {
      if (query.includes('system.merges')) {
        return {
          data: [{ active_merges: 25, total_merge_size: '50 GiB' }],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    const result = await call({ hostId: 0, lastHours: 1 })
    const report = JSON.parse(result.content[0].text)

    expect(report.merge_backlog.severity).toBe('WARNING')
  })

  test('returns isError when all queries fail', async () => {
    mockFetchData.mockResolvedValue({
      data: null,
      error: new Error('Connection refused'),
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    const result = await call({ hostId: 0, lastHours: 1 })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('All queries failed')
  })

  test('partial errors included in report but not isError', async () => {
    let callCount = 0
    mockFetchData.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return { data: null, error: new Error('Timeout') }
      }
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    callCount = 0
    const result = await call({ hostId: 0, lastHours: 1 })

    expect(result.isError).toBeUndefined()
    const report = JSON.parse(result.content[0].text)
    expect(report.errors).toBeDefined()
    expect(report.errors.length).toBe(1)
    expect(report.errors[0]).toContain('Timeout')
  })

  test('uses default hostId 0 and lastHours 1', async () => {
    const calls: any[] = []
    mockFetchData.mockImplementation(async (params: any) => {
      calls.push(params)
      return { data: [], error: null }
    })

    const server = new McpServer({ name: 'test', version: '0.0.1' })
    registerPerformanceTool(server)
    const call = getToolHandler(server, 'analyze_performance')

    await call({})

    expect(calls.length).toBe(5)
    for (const c of calls) {
      expect(c.hostId).toBe(0)
    }

    const slowQueryCall = calls.find((c: any) => c.query_params?.hours)
    expect(slowQueryCall?.query_params?.hours).toBe('1')
  })
})
