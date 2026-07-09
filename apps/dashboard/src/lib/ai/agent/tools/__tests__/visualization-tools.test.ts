import { mockFetchData } from './shared-mocks'
import { describe, expect, test } from 'bun:test'

function setupVisualizationMocks() {
  mockFetchData.mockImplementation(
    async ({
      query,
    }: {
      query: string
      query_params?: Record<string, unknown>
    }) => {
      const q = query

      // Default: return sample rows with mixed types for query_and_visualize
      if (q.includes('system.tables') && q.includes('total_bytes')) {
        return {
          data: [
            { name: 'events', total_rows: 1000, total_bytes: 5000000 },
            { name: 'users', total_rows: 500, total_bytes: 2000000 },
          ],
          error: null,
        }
      }

      // count-only query
      if (q.includes('count()') && !q.includes('countDistinct')) {
        return {
          data: [{ count: 42 }],
          error: null,
        }
      }

      // Generic rows for visualization
      return {
        data: [
          {
            event_date: '2026-05-30',
            tenant_id: 1,
            event_name: 'click',
            value: 3.14,
          },
          {
            event_date: '2026-05-29',
            tenant_id: 2,
            event_name: 'view',
            value: 2.71,
          },
        ],
        error: null,
      }
    }
  )
}

const { createVisualizationTools } = await import('../visualization-tools')

describe('createVisualizationTools', () => {
  test('creates visualization tools', () => {
    const tools = createVisualizationTools(0) as any as any
    expect(tools.query_and_visualize).toBeDefined()
  })

  describe('query_and_visualize', () => {
    test('returns visualization config with auto-detected dimensions', async () => {
      setupVisualizationMocks()

      const tools = createVisualizationTools(0) as any as any

      const result = await tools.query_and_visualize.execute({
        sql: 'SELECT event_date, tenant_id, event_name, value FROM analytics.events LIMIT 10',
      })

      expect(result.type).toBe('visualization')
      expect(result.rowCount).toBe(2)
      expect(result.columns).toEqual([
        'event_date',
        'tenant_id',
        'event_name',
        'value',
      ])
      expect(result.viz.xKey).toBe('event_date') // first string column
      expect(result.viz.yKeys).toContain('value') // numeric column
      expect(result.viz.chartType).toBe('bar')
    })

    test('uses provided title and chartType', async () => {
      setupVisualizationMocks()

      const tools = createVisualizationTools(0) as any as any

      const result = await tools.query_and_visualize.execute({
        sql: 'SELECT count() FROM analytics.events',
        title: 'Total Events',
        chartType: 'number',
      })

      expect(result.title).toBe('Total Events')
      expect(result.viz.chartType).toBe('number')
    })

    test('auto-detects number chart for single-row single-metric result', async () => {
      mockFetchData.mockImplementation(async () => ({
        data: [{ metric: 'total', cnt: 42 }],
        error: null,
      }))

      const tools = createVisualizationTools(0) as any as any

      const result = await tools.query_and_visualize.execute({
        sql: 'SELECT metric, count() as cnt FROM analytics.events',
      })

      expect(result.rowCount).toBe(1)
      expect(result.viz.yKeys).toHaveLength(1)
      expect(result.viz.chartType).toBe('number')
    })

    test('passes through sortBy, sortOrder, readable options', async () => {
      setupVisualizationMocks()

      const tools = createVisualizationTools(0) as any as any

      const result = await tools.query_and_visualize.execute({
        sql: 'SELECT event_date, value FROM analytics.events',
        sortBy: 'value',
        sortOrder: 'desc',
        readable: 'bytes',
      })

      expect(result.viz.sortBy).toBe('value')
      expect(result.viz.sortOrder).toBe('desc')
      expect(result.viz.readable).toBe('bytes')
    })

    test('uses sql slice as title when no title provided', async () => {
      setupVisualizationMocks()

      const tools = createVisualizationTools(0) as any as any

      const sql = 'SELECT * FROM system.tables WHERE total_bytes > 1000000'
      const result = await tools.query_and_visualize.execute({ sql })

      expect(result.title).toBe(sql.slice(0, 60))
    })

    test('uses provided xKey and yKeys when specified', async () => {
      setupVisualizationMocks()

      const tools = createVisualizationTools(0) as any as any

      const result = await tools.query_and_visualize.execute({
        sql: 'SELECT event_date, value FROM analytics.events',
        xKey: 'event_date',
        yKeys: ['value'],
      })

      expect(result.viz.xKey).toBe('event_date')
      expect(result.viz.yKeys).toEqual(['value'])
    })

    test('falls back to all non-xKey columns when no numeric yKeys found', async () => {
      mockFetchData.mockImplementation(async () => ({
        data: [
          { event_date: '2026-05-30', event_name: 'click' },
          { event_date: '2026-05-29', event_name: 'view' },
        ],
        error: null,
      }))

      const tools = createVisualizationTools(0) as any as any

      const result = await tools.query_and_visualize.execute({
        sql: 'SELECT event_date, event_name FROM analytics.events',
        xKey: 'event_date',
      })

      expect(result.viz.yKeys).toEqual(['event_name'])
    })

    test('does not include sortBy/sortOrder/readable when not provided', async () => {
      setupVisualizationMocks()

      const tools = createVisualizationTools(0) as any as any

      const result = await tools.query_and_visualize.execute({
        sql: 'SELECT count() FROM analytics.events',
      })

      expect(result.viz.sortBy).toBeUndefined()
      expect(result.viz.sortOrder).toBeUndefined()
      expect(result.viz.readable).toBeUndefined()
    })

    test('caps rows at 1000 and flags truncation, building the chart from capped data', async () => {
      mockFetchData.mockImplementation(async () => ({
        data: Array.from({ length: 1500 }, (_, i) => ({
          label: `row_${i}`,
          value: i,
        })),
        error: null,
      }))

      const tools = createVisualizationTools(0) as any as any

      const result = await tools.query_and_visualize.execute({
        sql: 'SELECT label, value FROM big_table',
      })

      expect(result.rows).toHaveLength(1000)
      expect(result.rowCount).toBe(1000)
      expect(result.truncated).toBe(true)
      expect(result.note).toContain('truncated to 1000 rows')
    })

    test('does not flag truncation for results at or under 1000 rows', async () => {
      setupVisualizationMocks()

      const tools = createVisualizationTools(0) as any as any

      const result = await tools.query_and_visualize.execute({
        sql: 'SELECT event_date, tenant_id, event_name, value FROM analytics.events LIMIT 10',
      })

      expect(result.truncated).toBe(false)
      expect(result.note).toBeUndefined()
    })
  })
})
