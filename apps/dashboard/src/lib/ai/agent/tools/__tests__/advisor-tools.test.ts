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
    if (q.includes('system.data_skipping_indices'))
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
describe('get_tuning_suggestions', () => {
  type Call = {
    query: string
    hostId?: number
    query_params?: Record<string, unknown>
  }

  function setupTuningMock(calls: Call[]) {
    mockFetchData.mockImplementation(async (params: Call) => {
      calls.push(params)
      const q = params.query.toLowerCase()
      if (q.includes('from system.columns'))
        return {
          data: [
            {
              database: 'shop',
              table: 'orders',
              name: 'note',
              type: 'Nullable(String)',
              compression_codec: '',
              is_in_sorting_key: 0,
              compressed_bytes: 1000,
              uncompressed_bytes: 5000,
            },
          ],
          error: null,
        }
      return { data: [], error: null }
    })
  }

  function columnsCall(calls: Call[]) {
    const found = calls.find((c) =>
      c.query.toLowerCase().includes('from system.columns')
    )
    if (!found) throw new Error('system.columns was never queried')
    return found
  }

  function tool(hostId = 0) {
    return (createAdvisorTools(hostId) as any).get_tuning_suggestions
  }

  test('is registered and recommend-only', () => {
    expect(tool().description).toContain('recommend-only')
  })

  test('validates input: database is required, hostId is coerced', async () => {
    const { asSchema } = await import('ai')
    const schema = asSchema(tool().inputSchema)
    const validate = async (v: unknown) =>
      (await schema.validate!(v)) as { success: boolean; value?: any }

    expect((await validate({})).success).toBe(false)
    expect((await validate({ database: 'shop', hostId: -1 })).success).toBe(
      false
    )
    const ok = await validate({ database: 'shop', hostId: '2', table: 't' })
    expect(ok.success).toBe(true)
    expect(ok.value.hostId).toBe(2)
    const blank = await validate({ database: 'shop', hostId: '  ' })
    expect(blank.value.hostId).toBeUndefined()
  })

  test('returns ranked findings and passes database/table as bound params', async () => {
    const calls: Call[] = []
    setupTuningMock(calls)
    const result = await tool().execute({ database: 'shop', table: 'orders' })

    expect(result.ok).toBe(true)
    expect(result.type).toBe('schema_tuning_findings')
    expect(result.database).toBe('shop')
    expect(result.table).toBe('orders')
    expect(
      result.findings.some((f: any) => f.title.includes('shop.orders.note'))
    ).toBe(true)

    const call = columnsCall(calls)
    expect(call.query).toContain('{database:String}')
    expect(call.query).toContain('{table:String}')
    expect(call.query).not.toContain('shop')
    expect(call.query_params).toMatchObject({
      database: 'shop',
      table: 'orders',
    })
  })

  test('omits table from the result and filter when scanning a whole database', async () => {
    const calls: Call[] = []
    setupTuningMock(calls)
    const result = await tool().execute({ database: 'shop' })

    expect(result.ok).toBe(true)
    expect('table' in result).toBe(false)
    expect(columnsCall(calls).query).not.toContain('{table:String}')
  })

  test('uses the factory hostId by default', async () => {
    const calls: Call[] = []
    setupTuningMock(calls)
    await tool(5).execute({ database: 'shop' })

    expect(columnsCall(calls).hostId).toBe(5)
  })

  test('input hostId overrides the factory hostId, including 0', async () => {
    const calls: Call[] = []
    setupTuningMock(calls)
    await tool(5).execute({ database: 'shop', hostId: 0 })

    expect(columnsCall(calls).hostId).toBe(0)
  })

  test('refuses internal databases without querying ClickHouse', async () => {
    const calls: Call[] = []
    setupTuningMock(calls)
    const result = await tool().execute({ database: 'system' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('internal database')
    expect(calls.length).toBe(0)
  })

  test('reports a clear error when the table has no columns', async () => {
    mockFetchData.mockImplementation(async () => ({ data: [], error: null }))
    const result = await tool().execute({ database: 'shop', table: 'nope' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('shop.nope')
  })

  test('surfaces a schema read failure as an error result', async () => {
    mockFetchData.mockImplementation(async (params: Call) => {
      if (params.query.toLowerCase().includes('from system.columns'))
        return { data: null, error: { message: 'boom' } }
      return { data: [], error: null }
    })
    const result = await tool().execute({ database: 'shop' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Could not read schema for shop')
  })
})
