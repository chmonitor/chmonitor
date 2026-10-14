import { metadataCache } from '../helpers'
import { mockFetchData } from './shared-mocks'
import { beforeEach, describe, expect, test } from 'bun:test'

type Call = { query: string; query_params?: Record<string, unknown> }

let calls: Call[] = []
let columnsByTable: Record<string, string[]> = {}
let rowsFor: (q: string) => unknown[] = () => []

function setup() {
  calls = []
  mockFetchData.mockImplementation(async (params: Call) => {
    calls.push(params)
    if (params.query.includes('system.columns')) {
      const table = String(params.query_params?.table)
      return {
        data: (columnsByTable[table] ?? []).map((name) => ({ name })),
        error: null,
      }
    }
    return { data: rowsFor(params.query), error: null }
  })
}

const { createDocsLookupTools } = await import('../docs-lookup-tools')

const run = (input: Record<string, unknown>) =>
  (createDocsLookupTools(0) as any).explain_clickhouse_symbol.execute(input)

const NEW_FUNCTION_COLUMNS = [
  'name',
  'is_aggregate',
  'description',
  'syntax',
  'examples',
  'introduced_in',
  'categories',
]

beforeEach(() => {
  metadataCache.clear()
  columnsByTable = {}
  rowsFor = () => []
  setup()
})

describe('explain_clickhouse_symbol', () => {
  test('selects only the columns an older server has (no introduced_in)', async () => {
    columnsByTable.functions = ['name', 'is_aggregate', 'description']
    rowsFor = (q) =>
      q.includes('FROM system.functions')
        ? [{ name: 'quantile', is_aggregate: 1, description: 'approx' }]
        : []

    const result = await run({ name: 'quantile', kind: 'function' })

    const lookup = calls.find((c) => c.query.includes('FROM system.functions'))
    expect(lookup).toBeDefined()
    expect(lookup!.query).not.toContain('introduced_in')
    expect(lookup!.query).not.toContain('examples')
    expect(lookup!.query).toContain('`description`')
    expect(lookup!.query_params).toEqual({ name: 'quantile' })
    expect(result).toEqual({
      found: true,
      kind: 'function',
      entry: { name: 'quantile', is_aggregate: 1, description: 'approx' },
    })
  })

  test('includes introduced_in and truncates long examples on a new server', async () => {
    columnsByTable.functions = NEW_FUNCTION_COLUMNS
    rowsFor = (q) =>
      q.includes('FROM system.functions')
        ? [
            {
              name: 'toStartOfInterval',
              introduced_in: '20.1.0',
              examples: 'x'.repeat(5000),
              syntax: '',
            },
          ]
        : []

    const result = await run({ name: 'toStartOfInterval', kind: 'function' })

    const lookup = calls.find((c) => c.query.includes('FROM system.functions'))
    expect(lookup!.query).toContain('`introduced_in`')
    expect(result.entry.introduced_in).toBe('20.1.0')
    expect(result.entry.examples.length).toBeLessThan(1300)
    expect(result.entry.examples).toContain('[truncated')
    expect('syntax' in result.entry).toBe(false)
  })

  test('not found returns suggestions, never a fabricated entry', async () => {
    columnsByTable.settings = ['name', 'type', 'default', 'description']
    rowsFor = (q) => (q.includes('ILIKE') ? [{ name: 'max_threads' }] : [])

    const result = await run({ name: 'max_thread', kind: 'setting' })

    expect(result.found).toBe(false)
    expect(result.entry).toBeUndefined()
    expect(result.suggestions).toEqual(['max_threads'])
    const suggest = calls.find((c) => c.query.includes('ILIKE'))
    expect(suggest!.query_params).toEqual({ pattern: '%max\\_thread%' })
  })

  test('metric lookups key on the metric column', async () => {
    columnsByTable.metrics = ['metric', 'value', 'description']
    rowsFor = (q) =>
      q.includes('FROM system.metrics')
        ? [{ metric: 'Query', value: 2, description: 'Number of queries' }]
        : []

    const result = await run({ name: 'Query', kind: 'metric' })

    const lookup = calls.find((c) => c.query.includes('FROM system.metrics'))
    expect(lookup!.query).toContain('`metric` = {name:String}')
    expect(result.found).toBe(true)
  })

  test('search spans functions and settings with a parameterized LIKE and limit', async () => {
    columnsByTable.functions = NEW_FUNCTION_COLUMNS
    columnsByTable.settings = ['name']
    rowsFor = (q) =>
      q.includes('UNION ALL')
        ? [{ kind: 'function', name: 'quantile', summary: 'Computes' }]
        : []

    const result = await run({ name: 'quantile', kind: 'search', limit: 5 })

    const search = calls.find((c) => c.query.includes('UNION ALL'))
    expect(search).toBeDefined()
    expect(search!.query).toContain('FROM system.functions')
    expect(search!.query).toContain('FROM system.settings')
    // settings has no description on this host, so only its name is matched
    expect(search!.query).toContain(
      "'setting' AS kind, name, '' AS summary FROM system.settings WHERE name ILIKE {pattern:String}"
    )
    expect(search!.query).not.toContain("'quantile'")
    expect(search!.query_params).toEqual({
      pattern: '%quantile%',
      term: 'quantile',
      limit: 5,
    })
    expect(result.count).toBe(1)
    expect(result.results[0].name).toBe('quantile')
  })
})
