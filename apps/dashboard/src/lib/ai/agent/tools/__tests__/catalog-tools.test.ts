/**
 * Unit tests for `search_tools` — on-demand tool discovery.
 *
 * The important behaviors, in order of risk:
 *  - it never advertises a tool that is not registered this request (the
 *    Postgres / PeerDB / control gates),
 *  - it returns the live tool description rather than a duplicated copy,
 *  - it caps its output the house way,
 *  - plain-language queries route to the right tool.
 */
import { afterAll, describe, expect, test } from 'bun:test'

const originalControlToolsEnv = process.env.AGENT_ENABLE_CONTROL_TOOLS
const originalPostgresEnv = process.env.CHM_FEATURE_POSTGRES_SOURCE
const originalPeerDBAgentEnv = process.env.CHM_FEATURE_PEERDB_AGENT

const setGates = (control: boolean, postgres: boolean, peerdb: boolean) => {
  if (control) process.env.AGENT_ENABLE_CONTROL_TOOLS = 'true'
  else delete process.env.AGENT_ENABLE_CONTROL_TOOLS
  if (postgres) process.env.CHM_FEATURE_POSTGRES_SOURCE = 'true'
  else delete process.env.CHM_FEATURE_POSTGRES_SOURCE
  if (peerdb) process.env.CHM_FEATURE_PEERDB_AGENT = 'true'
  else delete process.env.CHM_FEATURE_PEERDB_AGENT
}

afterAll(() => {
  for (const [key, value] of [
    ['AGENT_ENABLE_CONTROL_TOOLS', originalControlToolsEnv],
    ['CHM_FEATURE_POSTGRES_SOURCE', originalPostgresEnv],
    ['CHM_FEATURE_PEERDB_AGENT', originalPeerDBAgentEnv],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const { createAllTools } = await import('../index')
const { TOOL_SEARCH_RESULT_LIMIT } = await import('../catalog')

type ToolMap = Record<string, any>

const run = async (tools: ToolMap, input: unknown) =>
  (await tools.search_tools.execute(input)) as any

describe('search_tools — gate contract', () => {
  test('never advertises a gated-off tool, and names it as unavailable', async () => {
    setGates(false, false, false)
    const tools = createAllTools(0, false) as ToolMap
    const result = await run(tools, { query: 'postgres' })

    // Nothing gated is in the results...
    for (const r of result.results) {
      expect(r.name).not.toStartWith('get_postgres')
      expect(r.name).not.toStartWith('kill_')
      expect(r.name).not.toStartWith('optimize_')
      expect(r.name).not.toStartWith('get_peerdb')
    }
    // ...and the model is told why, rather than concluding it does not exist.
    expect(result.unavailable_due_to_gates).toContain('get_postgres_metrics')
    expect(result.unavailable_due_to_gates).toContain('kill_query')
    expect(result.unavailable_due_to_gates).toContain('get_peerdb_metrics')
    expect(result.callable_tool_count).toBe(Object.keys(tools).length)
  })

  test('advertises a gated tool once its gate is on', async () => {
    setGates(true, true, true)
    const tools = createAllTools(0, true) as ToolMap
    const result = await run(tools, { query: 'peerdb replication slot lag' })
    expect(result.results.map((r: { name: string }) => r.name)).toContain(
      'get_peerdb_metrics'
    )
    expect(result.unavailable_due_to_gates).toEqual([])
  })

  test('respects the control-tools gate separately from includeControlTools', async () => {
    setGates(true, false, false)
    const tools = createAllTools(0, false) as ToolMap
    // The env flag is on but the caller did not opt in, so the destructive
    // tools are absent. The query still matches read-only tools (a running
    // query, a query pattern), so assert on the gate, not on an empty list.
    const result = await run(tools, { query: 'kill a running query' })
    const names = result.results.map((r: { name: string }) => r.name)
    expect(names).not.toContain('kill_query')
    expect(names).not.toContain('kill_mutation')
    expect(names).not.toContain('optimize_table')
    expect(result.unavailable_due_to_gates).toContain('kill_query')
  })
})

describe('search_tools — routing', () => {
  beforeAllGates()
  function beforeAllGates() {
    setGates(false, false, false)
  }

  test('routes a plain-language question to the right tool', async () => {
    const tools = createAllTools(0, false) as ToolMap
    const cases: [string, string][] = [
      ['which replication slot is lagging worst', 'get_replication_status'],
      [
        'recommend a skip index for this query',
        'get_optimization_recommendations',
      ],
      ['when will the disk fill up', 'forecast_disk_capacity'],
      ['chart the query volume per hour', 'query_and_visualize'],
      ['what columns does this table have', 'get_table_schema'],
      ['explain this anomaly z-score', 'explain_anomaly_score'],
      ['write a weekly health report', 'generate_cluster_report'],
      ['part level details and compression for this table', 'get_table_parts'],
    ]
    for (const [q, expected] of cases) {
      const result = await run(tools, { query: q })
      const names = result.results.map((r: { name: string }) => r.name)
      expect(names.slice(0, 5)).toContain(expected)
    }
  })

  test('routes "what does this page show" questions to get_page_data', async () => {
    const tools = createAllTools(0, false) as ToolMap
    for (const q of [
      'what does the merges page show',
      'what is on the keeper dashboard page',
      'show me the traffic page data',
    ]) {
      const result = await run(tools, { query: q })
      const names = result.results.map((r: { name: string }) => r.name)
      expect(names.slice(0, 3)).toContain('get_page_data')
    }
  })

  test('prefers a name match over a keyword-only match', async () => {
    const tools = createAllTools(0, false) as ToolMap
    const result = await run(tools, { query: 'get_merge_status' })
    expect(result.results[0].name).toBe('get_merge_status')
  })

  test('does not invent a match for an unrelated query', async () => {
    const tools = createAllTools(0, false) as ToolMap
    const result = await run(tools, { query: 'zzzz qqqq unrelated nonsense' })
    expect(result.results).toEqual([])
    expect(result.matched).toBe(0)
  })

  test('returns the live tool description, not a catalog copy', async () => {
    const tools = createAllTools(0, false) as ToolMap
    const result = await run(tools, { query: 'get_metrics' })
    const hit = result.results.find(
      (r: { name: string }) => r.name === 'get_metrics'
    )
    expect(hit.description).toBe(tools.get_metrics.description)
    // And the catalog supplies the routing-only summary.
    expect(hit.summary).toBeTruthy()
    expect(hit.summary).not.toBe(tools.get_metrics.description)
  })

  test('with no query, lists the core set and the categories', async () => {
    const tools = createAllTools(0, false) as ToolMap
    const result = await run(tools, {})
    expect(result.query).toBe('')
    const names = result.results.map((r: { name: string }) => r.name)
    expect(names).toContain('query')
    expect(names).toContain('search_tools')
    // Gated tools are not in the core set, so they must be absent here.
    expect(names).not.toContain('kill_query')
    expect(result.categories).toContain('schema')
    expect(result.categories).toContain('discovery')
  })

  test('includeCore: false returns only the discoverable long tail', async () => {
    const tools = createAllTools(0, false) as ToolMap
    const result = await run(tools, { includeCore: false })
    const names = result.results.map((r: { name: string }) => r.name)
    expect(names).not.toContain('query')
    expect(names).not.toContain('search_tools')
    expect(names.length).toBeGreaterThan(0)
    for (const r of result.results) expect(r.core).toBe(false)
  })

  test('a category filter narrows the result and echoes back', async () => {
    const tools = createAllTools(0, false) as ToolMap
    const result = await run(tools, { category: 'visualization' })
    expect(result.category).toBe('visualization')
    for (const r of result.results) expect(r.category).toBe('visualization')
    expect(result.results.map((r: { name: string }) => r.name)).toContain(
      'query_and_visualize'
    )
  })
})

describe('search_tools — output bounds', () => {
  test('caps results and flags truncation the house way', async () => {
    setGates(true, true, true)
    const tools = createAllTools(0, true) as ToolMap
    // A query matching nearly everything.
    const result = await run(tools, { query: 'get', includeCore: true })
    expect(result.results.length).toBeLessThanOrEqual(TOOL_SEARCH_RESULT_LIMIT)
    if (result.truncated) {
      expect(result.note).toContain(String(TOOL_SEARCH_RESULT_LIMIT))
    }
    expect(result.matched).toBeGreaterThan(result.results.length)
  })

  test('an over-long query is bounded, not passed through unbounded', async () => {
    const tools = createAllTools(0, false) as ToolMap
    // The AI SDK validates `inputSchema` (`.max(200)`) before `execute`, but
    // `execute` is directly reachable, so the bound is re-applied inside. Either
    // way the model must not be able to make this unbounded.
    const result = await run(tools, { query: 'x'.repeat(5000) })
    expect(result.query.length).toBeLessThanOrEqual(200)
  })
})

describe('search_tools — no I/O', () => {
  test('resolves nothing but from its bound tool map', async () => {
    setGates(false, false, false)
    const tools = createAllTools(0, false) as ToolMap
    const before = globalThis.fetch
    try {
      const result = await run(tools, { query: 'anything at all' })
      expect(result).toBeTruthy()
      // Discovery must never reach ClickHouse or any provider.
      expect(globalThis.fetch).toBe(before)
    } finally {
      globalThis.fetch = before
    }
  })
})
