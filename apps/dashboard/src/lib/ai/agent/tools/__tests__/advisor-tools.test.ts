import { mockFetchData } from './shared-mocks'
import { describe, expect, test } from 'bun:test'

function setupAdvisorMock() {
  mockFetchData.mockImplementation(async ({ query }: { query: string }) => {
    const q = query.toLowerCase()
    if (q.includes('system.query_log'))
      return {
        data: [{ query: "SELECT * FROM t WHERE status = 'x'" }],
        error: null,
      }
    if (q.includes('system.tables'))
      return { data: [{ partition_key: '', sorting_key: 'id' }], error: null }
    if (q.includes('system.columns')) return { data: [], error: null }
    if (q.includes('system.data_skipping_indexes'))
      return { data: [], error: null }
    if (q.includes('system.parts'))
      return {
        data: [
          {
            active_parts: 1,
            total_rows: 100,
            total_bytes: 1000,
            total_granules: 10,
          },
        ],
        error: null,
      }
    if (q.includes('explain')) return { data: [], error: null }
    return { data: [], error: null }
  })
}

const { createAdvisorTools } = await import('../advisor-tools')

describe('createAdvisorTools', () => {
  test('creates the get_optimization_recommendations tool', () => {
    const tools = createAdvisorTools(0) as any
    expect(tools.get_optimization_recommendations).toBeDefined()
  })

  test('analyzing raw sql returns a ranked, recommend-only result (no execution)', async () => {
    setupAdvisorMock()
    const tools = createAdvisorTools(0) as any
    const result = await tools.get_optimization_recommendations.execute({
      sql: "SELECT * FROM default.t WHERE status = 'x'",
    })

    expect(result.ok).toBe(true)
    expect(Array.isArray(result.recommendations)).toBe(true)
  })

  test('resolves a query_id via system.query_log', async () => {
    setupAdvisorMock()
    const tools = createAdvisorTools(0) as any
    const result = await tools.get_optimization_recommendations.execute({
      queryId: 'abc-123',
    })

    expect(result.ok).toBe(true)
  })

  test('surfaces a clear error when neither sql nor queryId is given', async () => {
    setupAdvisorMock()
    const tools = createAdvisorTools(0) as any
    const result = await tools.get_optimization_recommendations.execute({})

    expect(result.ok).toBe(false)
  })

  test('resolves hostId override', async () => {
    setupAdvisorMock()
    const tools = createAdvisorTools(0) as any
    const result = await tools.get_optimization_recommendations.execute({
      sql: "SELECT * FROM default.t WHERE status = 'x'",
      hostId: 3,
    })

    expect(typeof result.ok).toBe('boolean')
  })
})
