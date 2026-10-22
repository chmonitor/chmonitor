import { mockFetchData } from './shared-mocks'
import { describe, expect, test } from 'bun:test'

const GIB = 1024 ** 3

interface Fixture {
  window?: Record<string, unknown>[]
  tables?: Record<string, unknown>[]
  projections?: Record<string, unknown>[]
  columns?: Record<string, unknown>[]
  fail?: string
}

const seen: Array<{
  query: string
  query_params?: Record<string, unknown>
  clickhouse_settings?: Record<string, unknown>
}> = []

function setup(f: Fixture = {}) {
  seen.length = 0
  mockFetchData.mockImplementation(async (opts: any) => {
    seen.push(opts)
    const q: string = opts.query
    if (f.fail && q.includes(f.fail)) {
      return { data: [], error: { message: `boom ${f.fail}` } }
    }
    if (q.includes('FROM system.columns'))
      return { data: f.columns ?? [], error: null }
    if (q.includes('FROM system.projections'))
      return { data: f.projections ?? [], error: null }
    if (q.includes('FROM system.tables'))
      return { data: f.tables ?? [], error: null }
    if (q.includes('count() AS selects'))
      return {
        data: f.window ?? [
          { log_window_start: '2026-10-02', log_window_days: 20, selects: 9 },
        ],
        error: null,
      }
    return { data: [], error: null }
  })
}

const { createUsageTools } = await import('../usage-tools')
const tool = () => (createUsageTools(0) as any).get_usage_findings

describe('get_usage_findings', () => {
  test('returns the three lists with window, scope and caveats', async () => {
    setup({
      tables: [{ database: 'shop', table: 'old', bytes: 40 * GIB }],
      projections: [
        { database: 'shop', table: 'old', name: 'p', bytes: 2 * GIB },
      ],
    })
    const r = await tool().execute({})
    expect(r.ok).toBe(true)
    expect(r.scope).toBe('this replica only')
    expect(r.window).toEqual({
      start: '2026-10-02',
      days: 20,
      requested_days: 30,
      finished_selects: 9,
    })
    expect(r.unread_tables).toEqual([
      {
        database: 'shop',
        table: 'old',
        bytes: 40 * GIB,
        readable_bytes: '40 GiB',
      },
    ])
    expect(r.unused_projections[0]).toMatchObject({
      database: 'shop',
      table: 'old',
      name: 'p',
    })
    expect(r.unread_columns).toBeNull()
    expect(r.warning).toBeUndefined()
    const caveats = r.caveats.join(' ')
    expect(caveats).toContain('this replica')
    expect(caveats).toContain('Unread is not the same as unused')
    expect(caveats).toContain('SELECT *')
  })

  test('does not query columns unless both database and table are given', async () => {
    setup()
    await tool().execute({})
    expect(seen.some((s) => s.query.includes('FROM system.columns'))).toBe(
      false
    )
  })

  test('lists unread columns of one table through a bound parameter', async () => {
    setup({
      columns: [
        {
          database: 'shop',
          table: 'old',
          name: 'blob',
          type: 'String',
          bytes: 5 * GIB,
        },
      ],
    })
    const r = await tool().execute({ database: 'shop', table: 'old' })
    expect(r.unread_columns).toEqual([
      {
        database: 'shop',
        table: 'old',
        name: 'blob',
        type: 'String',
        bytes: 5 * GIB,
        readable_bytes: '5 GiB',
      },
    ])
    const colQuery = seen.find((s) => s.query.includes('FROM system.columns'))
    expect(colQuery?.query_params).toEqual({ table: 'shop.old' })
    expect(colQuery?.query).not.toContain('shop.old')
  })

  test('one of database/table is a clear error and runs no query', async () => {
    setup()
    for (const input of [{ database: 'shop' }, { table: 'old' }]) {
      const r = await tool().execute(input)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('both `database` and `table`')
    }
    expect(seen).toHaveLength(0)
  })

  test('a short log carries a warning not to present the rows as findings', async () => {
    setup({
      window: [
        { log_window_start: '2026-10-20', log_window_days: 2, selects: 3 },
      ],
      tables: [{ database: 'shop', table: 'old', bytes: 40 * GIB }],
    })
    const r = await tool().execute({})
    expect(r.warning).toContain('fewer than 7')
  })

  test('an empty log (NULL window) warns and reports no start', async () => {
    setup({
      window: [{ log_window_start: null, log_window_days: null, selects: 0 }],
    })
    const r = await tool().execute({})
    expect(r.window.start).toBeNull()
    expect(r.window.days).toBeNull()
    expect(r.warning).toContain('covers 0 days')
  })

  test('a failing section is reported and the others still return', async () => {
    setup({
      fail: 'FROM system.projections',
      tables: [{ database: 'shop', table: 'old', bytes: 40 * GIB }],
    })
    const r = await tool().execute({})
    expect(r.ok).toBe(false)
    expect(r.errors.unused_projections).toContain('boom')
    expect(r.unused_projections).toEqual([])
    expect(r.unread_tables).toHaveLength(1)
  })

  test('every query is read-only, capped, bounded and has a LIMIT', async () => {
    setup()
    await tool().execute({ database: 'shop', table: 'old' })
    expect(seen).toHaveLength(4)
    for (const s of seen) {
      expect((s as any).clickhouse_settings.readonly).toBe('1')
      expect((s as any).clickhouse_settings.max_execution_time).toBe(25)
      expect(s.query).toMatch(/event_date >= today\(\) - 30/)
      expect(s.query).not.toMatch(
        /\b(ALTER|DROP|INSERT|TRUNCATE|OPTIMIZE|KILL|DELETE)\b/i
      )
    }
    for (const s of seen.filter((x) => !x.query.includes('count() AS selects')))
      expect(s.query).toMatch(/LIMIT \d+\s*$/)
  })

  test('the description and output never invite removal', async () => {
    setup({ tables: [{ database: 'shop', table: 'old', bytes: 40 * GIB }] })
    const r = await tool().execute({})
    const text = `${tool().description} ${JSON.stringify(r)}`
    expect(text).not.toMatch(/\b(DROP|TRUNCATE|ALTER)\b/)
    expect(text).toMatch(/never says an object is safe to drop/i)
    expect(tool().description).toContain('window.start')
    expect(tool().description).toContain('THIS replica only')
  })
})
