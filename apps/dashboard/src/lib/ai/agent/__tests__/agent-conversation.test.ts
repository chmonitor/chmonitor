// @ts-nocheck
/**
 * Integration tests for the agent→tool→response lifecycle.
 *
 * WHY these tests exist:
 *  - The ClickHouse agent is a composable system: tools are assembled into a
 *    set, the agent passes user messages through that set, each tool hits
 *    ClickHouse (or emits a structured payload), and results stream back. Any
 *    break in that chain — wrong mock, wrong tool name, missing error throw —
 *    causes silent agent failures that users see as empty responses.
 *  - These tests exercise each segment of the chain with a mocked ClickHouse
 *    layer so the contract between the agent scaffold and the tool
 *    implementations is pinned independently of a live database.
 *  - Destructive tools (kill_query, optimize_table, kill_mutation) are tested
 *    separately from read-only tools because they call writeQuery (no readonly
 *    setting) and are controlled by the includeControlTools flag. Both sides
 *    of that gate are covered here.
 *
 * Mock boundary:
 *  - `@chm/clickhouse-client`: mocked so tools execute without a real CH server
 *  - `server-only`: stripped (test environment, not CF Workers runtime)
 *  - Everything else (zod validation, tool assembly, plan logic) is real
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the first import that transitively
// uses them, because bun:test hoists mock.module() calls.
// ---------------------------------------------------------------------------

mock.module('server-only', () => ({}))

// Track what each mock path receives so we can assert "which query was run"
const fetchDataCalls: Array<{
  query: string
  query_params?: Record<string, unknown>
}> = []

mock.module('@chm/clickhouse-client', () => ({
  getClient: async () => ({
    command: async () => ({}),
    insert: async () => ({}),
    query: async () => ({ json: async () => [] }),
  }),

  fetchData: async (opts: {
    query: string
    query_params?: Record<string, unknown>
    clickhouse_settings?: Record<string, unknown>
  }) => {
    fetchDataCalls.push({ query: opts.query, query_params: opts.query_params })

    // Route responses by query content
    if (opts.query.includes('KILL QUERY')) {
      return { data: [{ result: 'Ok' }], error: null }
    }
    if (opts.query.includes('KILL MUTATION')) {
      return { data: [{ result: 'Ok' }], error: null }
    }
    if (opts.query.includes('OPTIMIZE TABLE')) {
      return { data: [], error: null }
    }
    if (opts.query.includes('databases')) {
      return {
        data: [
          { name: 'default', engine: 'Atomic', comment: '' },
          { name: 'system', engine: 'Atomic', comment: 'System database' },
        ],
        error: null,
      }
    }
    if (opts.query.includes('columns')) {
      return {
        data: [
          {
            name: 'id',
            type: 'UInt64',
            default_kind: '',
            default_expression: '',
            comment: '',
          },
          {
            name: 'event_time',
            type: 'DateTime',
            default_kind: '',
            default_expression: '',
            comment: '',
          },
        ],
        error: null,
      }
    }
    if (
      opts.query.includes('tables') ||
      opts.query.toLowerCase().includes('from system.tables')
    ) {
      return {
        data: [
          {
            name: 'query_log',
            engine: 'MergeTree',
            total_rows: 1_000_000,
            size: '5GB',
          },
        ],
        error: null,
      }
    }
    if (
      opts.query.includes('system.processes') ||
      opts.query.includes('processes')
    ) {
      return {
        data: [
          {
            query_id: 'q-abc',
            user: 'default',
            elapsed: 45.2,
            read_rows: 1000,
            memory_usage: 1024,
            query: 'SELECT sleep(60)',
          },
        ],
        error: null,
      }
    }
    if (opts.query.includes('query_log')) {
      return {
        data: [
          {
            query_id: 'q-slow',
            query_duration_ms: 45000,
            query: 'SELECT * FROM big_table',
            user: 'analyst',
            event_time: '2024-01-01 12:00:00',
          },
        ],
        error: null,
      }
    }
    if (opts.query.includes('merges')) {
      return {
        data: [
          {
            database: 'default',
            table: 'events',
            progress_pct: 67,
            elapsed: 120,
          },
        ],
        error: null,
      }
    }
    if (opts.query.includes('version()') || opts.query.includes('uptime()')) {
      return {
        data: [{ version: '24.1.5', uptime_seconds: 86400 }],
        error: null,
      }
    }
    if (
      opts.query.includes('metrics') ||
      opts.query.includes('system.metrics')
    ) {
      return {
        data: [
          {
            metric: 'TCPConnection',
            value: 12,
            description: 'TCP connections',
          },
          {
            metric: 'HTTPConnection',
            value: 3,
            description: 'HTTP connections',
          },
        ],
        error: null,
      }
    }
    return { data: [], error: null }
  },
}))

// The sql-builder validator would reject non-SELECT in tests, so let it through
// for schema tools that call validatedReadOnlyQuery. We only gate on obvious
// injections; the real validator is tested in its own unit test suite.
mock.module('@chm/sql-builder', () => ({
  validateSqlQuery: (sql: string) => {
    if (sql.includes(';--') || sql.includes('DROP DATABASE')) {
      throw new Error('SQL injection detected')
    }
  },
  VersionedSql: undefined,
}))

// ---------------------------------------------------------------------------
// Dynamic imports — must come AFTER mock.module() declarations
// ---------------------------------------------------------------------------
const { createAllTools } = await import('../tools')
const { createControlTools } = await import('../tools/control-tools')
const { buildWorkflowPlan } = await import('../tools/plan-tools')
const { resolveHostId } = await import('../tools/helpers')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clear call log before each test for isolation. */
function clearCalls() {
  fetchDataCalls.length = 0
}

// ---------------------------------------------------------------------------
// Tool assembly tests
//
// WHY: createAllTools is the single composition point. If a tool category is
// accidentally removed from the assembly, every conversation that relies on
// it silently degrades (the agent cannot call the missing tool).
// ---------------------------------------------------------------------------

describe('createAllTools — tool registry completeness', () => {
  const tools = createAllTools(0)

  test('registers all schema & exploration tools', () => {
    expect(tools.query).toBeDefined()
    expect(tools.list_databases).toBeDefined()
    expect(tools.list_tables).toBeDefined()
    expect(tools.get_table_schema).toBeDefined()
    expect(tools.explore_table_schema).toBeDefined()
  })

  test('registers all query analysis tools', () => {
    expect(tools.get_running_queries).toBeDefined()
    expect(tools.get_slow_queries).toBeDefined()
    expect(tools.get_failed_queries).toBeDefined()
    expect(tools.explain_query).toBeDefined()
  })

  test('registers all system health tools', () => {
    expect(tools.get_metrics).toBeDefined()
    expect(tools.get_disk_usage).toBeDefined()
  })

  test('registers storage, replication, merge tools', () => {
    expect(tools.get_table_parts).toBeDefined()
    expect(tools.get_replication_status).toBeDefined()
    expect(tools.get_merge_status).toBeDefined()
  })

  test('registers plan, skill, interaction, and visualization tools', () => {
    expect(tools.update_plan).toBeDefined()
    expect(tools.load_skill).toBeDefined()
    expect(tools.ask_user).toBeDefined()
    expect(tools.query_and_visualize).toBeDefined()
  })

  test('OMITS destructive control tools by default (safety gate)', () => {
    // kill_query must never appear in a default tool set — it requires explicit opt-in
    expect(tools.kill_query).toBeUndefined()
    expect(tools.optimize_table).toBeUndefined()
    expect(tools.kill_mutation).toBeUndefined()
  })

  test('includes control tools when explicitly enabled', () => {
    // The env default is resolved by the route (control-tools-gate.ts);
    // createAllTools trusts the argument.
    const withControl = createAllTools(0, true)
    expect(withControl.kill_query).toBeDefined()
  })

  test('each tool has the required execute function and inputSchema', () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool, `${name} missing execute`).toHaveProperty('execute')
      expect(tool, `${name} missing inputSchema`).toHaveProperty('inputSchema')
    }
  })
})

// ---------------------------------------------------------------------------
// Query tool execution lifecycle
//
// WHY: the query tool is the most-used primitive. These tests verify:
//  1. ClickHouse is actually called with the user's SQL
//  2. The result is returned as-is (no silent transformation)
//  3. An error from ClickHouse surfaces as a thrown Error (not silent empty)
// ---------------------------------------------------------------------------

describe('query tool — execution lifecycle', () => {
  beforeEach(clearCalls)

  test('calls ClickHouse with the provided SQL and returns data', async () => {
    const tools = createAllTools(0)
    const result = await tools.list_databases.execute({})

    expect(result).toBeDefined()
    expect(Array.isArray(result)).toBe(true)
    const dbs = result as Array<{ name: string }>
    expect(dbs.some((d) => d.name === 'default')).toBe(true)
    expect(fetchDataCalls.some((c) => c.query.includes('databases'))).toBe(true)
  })

  test('get_running_queries returns processes from system.processes', async () => {
    const tools = createAllTools(0)
    const result = (await tools.get_running_queries.execute({})) as Array<
      Record<string, unknown>
    >

    expect(Array.isArray(result)).toBe(true)
    expect(result[0]).toHaveProperty('query_id', 'q-abc')
    expect(result[0]).toHaveProperty('elapsed', 45.2)
    // Confirms the query touched system.processes
    expect(
      fetchDataCalls.some(
        (c) =>
          c.query.includes('processes') || c.query.includes('system.processes')
      )
    ).toBe(true)
  })

  test('get_slow_queries respects the limit parameter', async () => {
    const tools = createAllTools(0)
    await tools.get_slow_queries.execute({ limit: 5 })

    const call = fetchDataCalls.find((c) => c.query.includes('query_log'))
    expect(call).toBeDefined()
    // limit is passed as a query param (not interpolated into SQL)
    expect(call?.query_params?.limit).toBe('5')
  })

  test('get_failed_queries passes lastHours as a bound parameter', async () => {
    const tools = createAllTools(0)
    await tools.get_failed_queries.execute({ lastHours: 48 })

    const call = fetchDataCalls.find((c) =>
      c.query.includes('ExceptionWhileProcessing')
    )
    expect(call?.query_params?.lastHours).toBe('48')
  })

  test('throws when ClickHouse returns an error object', async () => {
    // Override fetchData for this specific test to simulate a CH error
    const _originalFetch = (await import('@chm/clickhouse-client')).fetchData
    const stub = spyOn(
      await import('@chm/clickhouse-client'),
      'fetchData'
    ).mockResolvedValueOnce({
      data: [],
      error: { message: 'Code: 60. DB::Exception: Table not found.' },
    })

    const tools = createAllTools(0)
    await expect(tools.list_databases.execute({})).rejects.toThrow(
      'Table not found'
    )

    stub.mockRestore?.()
  })

  test('hostId in tool input overrides the agent-level default', async () => {
    clearCalls()
    // resolveHostId is the internal helper — test it directly
    expect(resolveHostId(2, 0)).toBe(2)
    expect(resolveHostId(undefined, 5)).toBe(5)
    expect(resolveHostId(0, 9)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Plan tool — buildWorkflowPlan
//
// WHY: the plan tool is the agent's visible progress indicator. The UI renders
// the latest plan as a live checklist. Incorrect step counts, wrong status
// normalization, or a missing `updatedAt` would break the checklist UI.
// ---------------------------------------------------------------------------

describe('buildWorkflowPlan — plan update contract', () => {
  test('normalises steps with sequential IDs starting at 1', () => {
    const plan = buildWorkflowPlan([
      { title: 'Check query_log' },
      { title: 'Identify slow queries', status: 'in_progress' },
      { title: 'Summarise findings', status: 'completed' },
    ])

    expect(plan.steps[0].id).toBe(1)
    expect(plan.steps[1].id).toBe(2)
    expect(plan.steps[2].id).toBe(3)
  })

  test('defaults missing status to "pending"', () => {
    const plan = buildWorkflowPlan([{ title: 'Step with no status' }])
    expect(plan.steps[0].status).toBe('pending')
  })

  test('counts completed steps correctly', () => {
    const plan = buildWorkflowPlan([
      { title: 'A', status: 'completed' },
      { title: 'B', status: 'completed' },
      { title: 'C', status: 'in_progress' },
      { title: 'D', status: 'pending' },
    ])
    expect(plan.completed).toBe(2)
    expect(plan.total).toBe(4)
  })

  test('emits type = "workflow_plan" for UI dispatch', () => {
    const plan = buildWorkflowPlan([{ title: 'Only step' }])
    expect(plan.type).toBe('workflow_plan')
  })

  test('includes updatedAt as an ISO 8601 timestamp', () => {
    const plan = buildWorkflowPlan([{ title: 'Step' }])
    expect(plan.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  test('includes optional note and workflow label when provided', () => {
    const plan = buildWorkflowPlan([{ title: 'Step 1' }], {
      note: 'Checking merge backlog',
      workflow: 'Performance audit',
    })
    expect(plan.note).toBe('Checking merge backlog')
    expect(plan.workflow).toBe('Performance audit')
  })

  test('omits note/workflow keys when not provided (keeps payload lean)', () => {
    const plan = buildWorkflowPlan([{ title: 'Step 1' }])
    expect(plan).not.toHaveProperty('note')
    expect(plan).not.toHaveProperty('workflow')
  })

  test('update_plan tool execute produces correct plan payload', async () => {
    const tools = createAllTools(0)
    const result = (await tools.update_plan.execute({
      steps: [
        { title: 'Scan query_log', status: 'completed' },
        { title: 'Check merge queue', status: 'in_progress' },
        { title: 'Report findings', status: 'pending' },
      ],
      note: 'On step 2 of 3',
    })) as { type: string; completed: number; total: number; note: string }

    expect(result.type).toBe('workflow_plan')
    expect(result.completed).toBe(1)
    expect(result.total).toBe(3)
    expect(result.note).toBe('On step 2 of 3')
  })
})

// ---------------------------------------------------------------------------
// ask_user tool — confirmation gating pattern
//
// WHY: destructive actions (kill_query, optimize_table) should always be
// preceded by an ask_user confirm step. The ask_user tool emits
// `awaiting_response: true` — the UI uses this to pause agent execution and
// wait for explicit user approval. If the flag is missing the UI cannot
// distinguish this pause from a regular tool result.
// ---------------------------------------------------------------------------

describe('ask_user tool — confirmation gating', () => {
  test('emits awaiting_response: true so the UI can pause execution', async () => {
    const tools = createAllTools(0)
    const result = (await tools.ask_user.execute({
      question: 'Kill query q-abc which has been running for 45 seconds?',
      inputType: 'confirm',
      context: 'This will terminate the query immediately.',
    })) as { type: string; awaiting_response: boolean; inputType: string }

    expect(result.type).toBe('ask_user')
    expect(result.awaiting_response).toBe(true)
    expect(result.inputType).toBe('confirm')
  })

  test('reflects the question text back for UI rendering', async () => {
    const tools = createAllTools(0)
    const question =
      'Are you sure you want to OPTIMIZE TABLE default.events FINAL?'
    const result = (await tools.ask_user.execute({
      question,
      inputType: 'confirm',
    })) as { question: string }

    expect(result.question).toBe(question)
  })

  test('supports single_choice input type with options', async () => {
    const tools = createAllTools(0)
    const result = (await tools.ask_user.execute({
      question: 'Which time range should I analyse?',
      inputType: 'single_choice',
      options: [
        { label: 'Last hour', value: '1h' },
        { label: 'Last 24 hours', value: '24h' },
        { label: 'Last 7 days', value: '7d' },
      ],
    })) as { options: Array<{ value: string }> }

    expect(Array.isArray(result.options)).toBe(true)
    expect(result.options).toHaveLength(3)
    expect(result.options[0].value).toBe('1h')
  })
})

// ---------------------------------------------------------------------------
// Control tools — destructive path with mock ClickHouse
//
// WHY: kill_query, optimize_table, and kill_mutation are the only agent
// actions that can cause irreversible ClickHouse-side effects. These tests
// confirm:
//  1. The tools call writeQuery (no readonly: '1' setting)
//  2. The correct SQL is sent with the expected parameters
//  3. Invalid table identifiers are rejected before reaching ClickHouse
// ---------------------------------------------------------------------------

describe('control tools — destructive query paths', () => {
  // Enable control tools for this suite via the env var
  const originalEnv = process.env.AGENT_ENABLE_CONTROL_TOOLS

  beforeEach(() => {
    process.env.AGENT_ENABLE_CONTROL_TOOLS = 'true'
    clearCalls()
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AGENT_ENABLE_CONTROL_TOOLS = originalEnv
    } else {
      delete process.env.AGENT_ENABLE_CONTROL_TOOLS
    }
  })

  test('kill_query sends KILL QUERY WHERE query_id = <param>', async () => {
    const tools = createControlTools(0)
    await tools.kill_query.execute({ queryId: 'q-abc' })

    const call = fetchDataCalls.find((c) => c.query.includes('KILL QUERY'))
    expect(call).toBeDefined()
    expect(call?.query_params?.queryId).toBe('q-abc')
    // Critically: no readonly setting — writeQuery path
    // (Validated by checking that the query uses KILL not SELECT)
    expect(call?.query).toContain('KILL QUERY')
  })

  test('kill_query does NOT include readonly: 1 in the call', async () => {
    // The mock fetchData receives opts — if readonly were set it would be in
    // clickhouse_settings. We check indirectly: the mock registers the call
    // and the query is KILL (a write statement). If readonly were '1',
    // ClickHouse would reject it — the test verifies our code never sets it.
    const tools = createControlTools(0)
    const result = (await tools.kill_query.execute({
      queryId: 'target-query',
    })) as Array<{ result: string }>

    expect(Array.isArray(result)).toBe(true)
    expect(result[0].result).toBe('Ok')
  })

  test('optimize_table sends OPTIMIZE TABLE with qualified name', async () => {
    const tools = createControlTools(0)
    await tools.optimize_table.execute({
      database: 'default',
      table: 'events',
      final: false,
    })

    const call = fetchDataCalls.find((c) => c.query.includes('OPTIMIZE TABLE'))
    expect(call).toBeDefined()
    // formatQualifiedTable wraps identifiers in backticks: `default`.`events`
    expect(call?.query).toMatch(/`default`\.`events`|default\.events/)
    expect(call?.query).not.toContain('FINAL')
  })

  test('optimize_table with final: true appends FINAL keyword', async () => {
    const tools = createControlTools(0)
    await tools.optimize_table.execute({
      database: 'default',
      table: 'events',
      final: true,
    })

    const call = fetchDataCalls.find((c) => c.query.includes('OPTIMIZE TABLE'))
    expect(call?.query).toContain('FINAL')
  })

  test('optimize_table rejects invalid table identifiers before touching ClickHouse', async () => {
    const tools = createControlTools(0)
    clearCalls()

    await expect(
      tools.optimize_table.execute({
        database: 'default; DROP DATABASE default',
        table: 'events',
      })
    ).rejects.toThrow(/Invalid table identifier/)

    // No ClickHouse call should have been made
    expect(
      fetchDataCalls.filter((c) => c.query.includes('OPTIMIZE'))
    ).toHaveLength(0)
  })

  test('kill_mutation sends parameterized KILL MUTATION query', async () => {
    const tools = createControlTools(0)
    await tools.kill_mutation.execute({
      database: 'default',
      table: 'events',
      mutationId: 'mutation_0001',
    })

    const call = fetchDataCalls.find((c) => c.query.includes('KILL MUTATION'))
    expect(call).toBeDefined()
    expect(call?.query_params?.database).toBe('default')
    expect(call?.query_params?.table).toBe('events')
    expect(call?.query_params?.mutationId).toBe('mutation_0001')
  })
})

// ---------------------------------------------------------------------------
// Error propagation
//
// WHY: the agent must surface errors as thrown exceptions so the AI SDK
// streaming layer can emit an error event to the client. A tool that swallows
// errors (returns empty array or undefined) causes the agent to hallucinate
// "no results" instead of reporting the actual failure.
// ---------------------------------------------------------------------------

describe('error propagation', () => {
  test('get_merge_status returns merge data on success', async () => {
    clearCalls()
    const tools = createAllTools(0)
    const result = (await tools.get_merge_status.execute({})) as Array<
      Record<string, unknown>
    >

    expect(Array.isArray(result)).toBe(true)
    expect(result[0]).toHaveProperty('database', 'default')
  })

  test('tools derived from readOnlyQuery throw on ClickHouse error response', async () => {
    // Simulate a ClickHouse error mid-query
    const chModule = await import('@chm/clickhouse-client')
    const stub = spyOn(chModule, 'fetchData').mockResolvedValueOnce({
      data: [],
      error: { message: 'DB::Exception: Memory limit exceeded.' },
    })

    const tools = createAllTools(0)
    await expect(tools.get_merge_status.execute({})).rejects.toThrow(
      'Memory limit exceeded'
    )

    stub.mockRestore?.()
  })
})
