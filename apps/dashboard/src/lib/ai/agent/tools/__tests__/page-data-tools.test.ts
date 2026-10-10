/**
 * Unit tests for `get_page_data`.
 *
 * The executor is mocked so these tests pin what the tool hands to it: which
 * sources a page resolves to, that filters reach the config's WHERE clause
 * (not just the params bag), that rows are truncated with a flag, that an
 * optional source's missing table is a note rather than an error, and that
 * charts go through the chart path.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'

type TableCall = { sql: unknown; name: string; params: unknown }
type ChartCall = { name: string; sql: unknown; params: unknown; opts: any }

const tableCalls: TableCall[] = []
const chartCalls: ChartCall[] = []
const multiCalls: string[][] = []
let tableImpl: (name: string) => {
  data?: unknown[]
  error?: { message: string }
} = () => ({ data: [] })
let chartImpl: (name: string) => {
  dataJson: string | null
  error?: { message: string }
} = () => ({ dataJson: '[]' })

mock.module('@/lib/api/query-executor', () => ({
  executeTableConfig: async (
    config: { name: string; sql: unknown },
    _hostId: number,
    params: unknown
  ) => {
    tableCalls.push({ name: config.name, sql: config.sql, params })
    const r = tableImpl(config.name)
    return {
      result: { data: r.data ?? null, error: r.error ?? null },
      executedSql: '',
      maxResultRows: 0,
    }
  },
  executeChartQuery: async (
    name: string,
    sql: unknown,
    _hostId: number,
    params: unknown,
    opts: unknown
  ) => {
    chartCalls.push({ name, sql, params, opts })
    const r = chartImpl(name)
    return { ...r, metadata: {}, executedSql: '' }
  },
  executeMultiChartQuery: async (queries: Array<{ key: string }>) => {
    multiCalls.push(queries.map((q) => q.key))
    return {
      results: queries.map((q) => ({ key: q.key, dataJson: '[{"v":1}]' })),
    }
  },
}))

const { createPageDataTools, PAGE_DATA_MAX_BYTES } = await import(
  '../page-data-tools'
)
const tool = createPageDataTools(0).get_page_data as any
const run = (input: unknown) => tool.execute(input) as Promise<any>

beforeEach(() => {
  tableCalls.length = 0
  chartCalls.length = 0
  multiCalls.length = 0
  tableImpl = () => ({ data: [] })
  chartImpl = () => ({ dataJson: '[]' })
})

describe('get_page_data — resolution', () => {
  test('a route runs every config and chart that page renders', async () => {
    const result = await run({ page: '/merges' })
    expect(result.page).toBe('/merges')
    expect(tableCalls.map((c) => c.name).sort()).toEqual([
      'merges',
      'recent-merges',
    ])
    // merge-count is a single-query chart; summary-used-by-merges is a
    // multi-query chart, which goes through the keyed multi executor.
    expect(chartCalls.map((c) => c.name)).toEqual(['merge-count'])
    expect(multiCalls).toHaveLength(1)
    expect(result.sources.map((s: any) => s.name)).toEqual([
      'merges',
      'recent-merges',
      'summary-used-by-merges',
      'merge-count',
    ])
    expect(result.sources.map((s: any) => s.kind)).toEqual([
      'table',
      'table',
      'chart',
      'chart',
    ])
  })

  test('route spelling is normalized (no slash, trailing slash, host param)', async () => {
    for (const page of ['merges', '/merges/', '/merges?host=1', 'Merges']) {
      const result = await run({ page })
      expect(result.page).toBe('/merges')
    }
  })

  test('an overview tab resolves through ?tab=', async () => {
    const result = await run({ page: '/overview?tab=storage' })
    expect(result.page).toBe('/overview/storage')
    expect(chartCalls.map((c) => c.name)).toContain('disk-usage-by-database')
  })

  test('falls back to a single query-config or chart name', async () => {
    const asConfig = await run({ page: 'keeper-snapshots' })
    expect(asConfig.sources).toHaveLength(1)
    expect(asConfig.sources[0]).toMatchObject({
      name: 'keeper-snapshots',
      kind: 'table',
    })

    const asChart = await run({ page: 'merge-count' })
    expect(asChart.sources).toHaveLength(1)
    expect(asChart.sources[0]).toMatchObject({
      name: 'merge-count',
      kind: 'chart',
    })
  })

  test('no page, or an unknown one, returns the page list and runs nothing', async () => {
    const none = await run({})
    expect(none.type).toBe('page_list')
    expect(Object.values(none.pages).flat()).toContain('/merges — Merges')

    const unknown = await run({ page: '/does-not-exist' })
    expect(unknown.type).toBe('page_list')
    expect(unknown.note).toContain('Unknown page')
    expect(tableCalls).toHaveLength(0)
    expect(chartCalls).toHaveLength(0)
  })

  test('a non-data page says so instead of pretending to have data', async () => {
    const result = await run({ page: '/sql' })
    expect(result.sources).toEqual([])
    expect(result.note).toContain('no query data')
  })
})

describe('get_page_data — filters and window', () => {
  test('filters reach the WHERE clause of a filterSchema config', async () => {
    await run({
      page: '/history-queries',
      filters: { user: 'alice', not_a_field: 'x' },
      lastHours: 6,
    })
    const call = tableCalls.find((c) => c.name === 'history-queries')
    expect(call).toBeDefined()
    // The resolved config has the clause baked into its SQL, and the value
    // travels as a bound parameter — never interpolated.
    expect(JSON.stringify(call?.sql)).toContain('user')
    expect(Object.values(call?.params as object)).toContain('alice')
    expect(Object.values(call?.params as object)).toContain('6')
    expect(JSON.stringify(call?.sql)).not.toContain('alice')

    const result = await run({
      page: 'history-queries',
      filters: { not_a_field: 'x' },
    })
    expect(result.sources[0].ignoredFilters).toEqual(['not_a_field'])
  })

  test('lastHours reaches a chart builder', async () => {
    await run({ page: 'merge-count', lastHours: 3 })
    expect(JSON.stringify(chartCalls[0].sql)).toContain('3')
  })
})

describe('get_page_data — output bounds', () => {
  test('limit truncates rows and flags it', async () => {
    tableImpl = () => ({
      data: Array.from({ length: 50 }, (_, i) => ({ i })),
    })
    const result = await run({ page: 'merges', limit: 5 })
    expect(result.sources[0].rows).toHaveLength(5)
    expect(result.sources[0].rowCount).toBe(50)
    expect(result.sources[0].truncated).toBe(true)
  })

  test('limit is clamped in execute even if the schema is bypassed', async () => {
    tableImpl = () => ({ data: Array.from({ length: 500 }, (_, i) => ({ i })) })
    const result = await run({ page: 'merges', limit: 10_000 })
    expect(result.sources[0].rows.length).toBeLessThanOrEqual(200)
  })

  test('total output stays under the byte budget', async () => {
    const wide = 'x'.repeat(400)
    tableImpl = () => ({
      data: Array.from({ length: 200 }, (_, i) => ({ i, wide })),
    })
    chartImpl = () => ({
      dataJson: JSON.stringify(
        Array.from({ length: 200 }, (_, i) => ({ i, wide }))
      ),
    })
    const result = await run({ page: '/merges', limit: 200 })
    expect(JSON.stringify(result.sources).length).toBeLessThanOrEqual(
      PAGE_DATA_MAX_BYTES
    )
    expect(result.sources.some((s: any) => s.truncated)).toBe(true)
  })
})

describe('get_page_data — errors and charts', () => {
  test('an optional source with a missing table is a note, not an error', async () => {
    tableImpl = () => ({
      error: { message: 'Table system.backup_log does not exist' },
    })
    const result = await run({ page: 'backups' })
    expect(result.sources[0].error).toBeUndefined()
    expect(result.sources[0].note).toContain('backup_log')
  })

  test('a required source failure is reported as an error', async () => {
    tableImpl = () => ({ error: { message: 'boom' } })
    const result = await run({ page: 'merges' })
    expect(result.sources[0].error).toBe('boom')
  })

  test('charts run through the chart executor and parse its JSON', async () => {
    chartImpl = () => ({ dataJson: '[{"event_time":"t","merges":3}]' })
    const result = await run({ page: 'merge-count' })
    expect(chartCalls).toHaveLength(1)
    expect(result.sources[0].rows).toEqual([{ event_time: 't', merges: 3 }])
    expect(result.sources[0].truncated).toBe(false)
  })
})
