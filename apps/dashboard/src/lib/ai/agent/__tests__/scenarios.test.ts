// @ts-nocheck — AI SDK generics (ToolLoopAgent / MockLanguageModelV3) are not
// worth fighting in test code; matches the existing convention in the sibling
// __tests__/clickhouse-agent.test.ts and __tests__/clickhouse-agent-openrouter.test.ts.
/**
 * Golden-scenario tests for the ClickHouse AI agent loop.
 *
 * Unlike the per-tool unit tests under `tools/__tests__/`, these tests drive
 * the REAL `createClickHouseAgent()` loop end-to-end — real tool set (from
 * `createAllTools`), real Zod input schemas, real system prompt — against a
 * scripted `MockLanguageModelV3` (from `ai/test`) instead of a live LLM, and a
 * mocked `@chm/clickhouse-client` instead of a live ClickHouse.
 *
 * The seam: `createClickHouseAgent`'s `model` option accepts either a
 * provider string (production) or a pre-built AI SDK `LanguageModel` instance
 * (test-only). See `../clickhouse-agent.ts`. No other production behavior
 * changes — every existing caller still passes a string.
 *
 * Each scenario scripts what the "LLM" says at each step (tool calls, then a
 * final answer) and asserts on what actually happened: which REAL tools were
 * called, with what (Zod-validated) arguments, against what mocked data, and
 * — the invariant that matters most — that no destructive control tool ever
 * actually executed. The final answer text is authored by the test (there is
 * no live model to reason), so assertions lean on the tool-call trace, which
 * is the part genuinely exercised end-to-end.
 *
 * Add a new golden here whenever an advisor / tool-selection feature ships
 * (see plans/51-agent-eval-golden-tests.md).
 */

import {
  DISK_USAGE_CRITICAL_ROWS,
  EXPLAIN_ROWS,
  FAILED_QUERY_ROWS,
  FRAGMENTED_PARTS_ROWS,
  MERGE_STATUS_ROWS,
  METRICS_ROWS,
  METRICS_UPTIME_ROWS,
  METRICS_VERSION_ROWS,
  QUERY_VOLUME_ROWS,
  REPLICATION_LAG_ROWS,
  RUNNING_QUERY_ROWS,
  SLOW_QUERY_ROWS,
  TABLES_ROWS,
} from './fixtures/system-tables'
import { describe, expect, mock, test } from 'bun:test'
import { MockLanguageModelV3 } from 'ai/test'

mock.module('server-only', () => ({}))

mock.module('@chm/sql-builder', () => ({
  validateSqlQuery: () => {
    // Passes by default — SQL validation itself is covered by
    // packages/sql-builder's own tests, not this suite.
  },
}))

const mockFetchData = mock(
  async (_params: { query: string; hostId?: number }) => ({
    data: [] as unknown[],
    error: null as { message: string } | null,
  })
)

mock.module('@chm/clickhouse-client', () => ({
  fetchData: mockFetchData,
  // findings-store (pulled in transitively via the tools index) imports
  // getClient at module-eval time — provide it so the import resolves.
  getClient: async () => ({
    command: async () => ({}),
    insert: async () => ({}),
    query: async () => ({ json: async () => [] }),
  }),
}))

// Dynamic import so the mock.module() calls above are guaranteed to apply
// before createClickHouseAgent's transitive imports resolve — bun 1.3.x may
// otherwise resolve static imports before mock.module hoisting (same pattern
// as __tests__/clickhouse-agent.test.ts).
const { createClickHouseAgent } = await import('../clickhouse-agent')

/**
 * Routes a mocked `fetchData` call to canned rows by matching a distinctive
 * substring of the real SQL each tool issues (see `tools/*.ts`). Add a branch
 * here whenever a new golden needs a new tool's data. Order matters only in
 * that each branch's substring must not collide with another tool's query.
 */
function routeQuery(query: string): unknown[] {
  if (query.includes('EXPLAIN')) return EXPLAIN_ROWS
  if (query.includes('QueryFinish')) return SLOW_QUERY_ROWS
  if (query.includes('ExceptionWhileProcessing')) return FAILED_QUERY_ROWS
  if (query.includes('system.processes')) return RUNNING_QUERY_ROWS
  if (query.includes('system.parts')) return FRAGMENTED_PARTS_ROWS
  if (query.includes('system.disks')) return DISK_USAGE_CRITICAL_ROWS
  if (query.includes('system.replicas')) return REPLICATION_LAG_ROWS
  if (query.includes('system.merges')) return MERGE_STATUS_ROWS
  if (query.includes('system.tables')) return TABLES_ROWS
  if (query.includes('version()')) return METRICS_VERSION_ROWS
  if (query.includes('uptime()')) return METRICS_UPTIME_ROWS
  if (query.includes('system.metrics')) return METRICS_ROWS
  if (query.includes('toStartOfHour')) return QUERY_VOLUME_ROWS
  return []
}

mockFetchData.mockImplementation(async ({ query }: { query: string }) => ({
  data: routeQuery(query),
  error: null,
}))

// ── Scripted-model helpers ─────────────────────────────────────────────────

const USAGE = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
}

/** One scripted LLM turn that calls a single tool. */
function toolCallTurn(toolName: string, input: Record<string, unknown>) {
  return {
    content: [
      {
        type: 'tool-call',
        toolCallId: `call_${toolName}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: 'tool-calls',
    usage: USAGE,
    warnings: [],
  }
}

/** The final scripted LLM turn — plain text, ends the tool loop. */
function textTurn(text: string) {
  return {
    content: [{ type: 'text', text }],
    finishReason: 'stop',
    usage: USAGE,
    warnings: [],
  }
}

/**
 * Builds a `createClickHouseAgent` instance wired to a scripted
 * `MockLanguageModelV3` (one entry in `turns` per LLM step) and runs it to
 * completion. Returns the agent (so tests can inspect its wired tool set),
 * the raw `generate()` result, and the flattened, ordered tool names called
 * across all steps.
 */
async function runAgentScenario(options: {
  prompt: string
  turns: unknown[]
  hostId?: number
  includeControlTools?: boolean
}) {
  const model = new MockLanguageModelV3({ doGenerate: options.turns })
  const agent = createClickHouseAgent({
    hostId: options.hostId ?? 0,
    model,
    includeControlTools: options.includeControlTools ?? false,
  })
  const result = await agent.generate({ prompt: options.prompt })
  return {
    agent,
    result,
    toolCallNames: result.toolCalls.map((c) => c.toolName),
  }
}

/** Tool names that mutate cluster state — see tools/control-tools.ts. */
const DESTRUCTIVE_TOOLS = new Set([
  'kill_query',
  'optimize_table',
  'kill_mutation',
])

/**
 * The core safety invariant for this suite: a destructive tool must never
 * actually EXECUTE (i.e. appear in `toolResults`) in any golden. The agent
 * may only recommend a destructive action in text (or via `update_plan`) and
 * explain how the user can apply it — never auto-apply it. Every scenario
 * below calls this directly (not wrapped in `expect().toThrow()`), so a
 * regression that lets a destructive tool actually run fails that scenario.
 */
function assertNoDestructiveExecution(result: {
  toolResults: Array<{ toolName: string }>
}) {
  const executed = result.toolResults
    .map((r) => r.toolName)
    .filter((name) => DESTRUCTIVE_TOOLS.has(name))
  if (executed.length > 0) {
    throw new Error(
      `Destructive tool(s) actually executed — recommend-only invariant violated: ${executed.join(', ')}`
    )
  }
}

// ── Golden scenarios ────────────────────────────────────────────────────────

describe('agent golden scenarios — query performance', () => {
  test('slow query: explains the cause and recommends an index/PREWHERE fix', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt: 'Why is our reporting query so slow today?',
      turns: [
        toolCallTurn('get_slow_queries', { limit: 5 }),
        toolCallTurn('explain_query', {
          sql: SLOW_QUERY_ROWS[0].query,
          type: 'indexes',
        }),
        textTurn(
          `The slowest query (${SLOW_QUERY_ROWS[0].query_id}, ${SLOW_QUERY_ROWS[0].query_duration_ms}ms) does a full scan with no PREWHERE and no index. Recommend adding a skip index on order_date and rewriting the filter as PREWHERE order_date >= today() - 180.`
        ),
      ],
    })

    expect(toolCallNames).toEqual(['get_slow_queries', 'explain_query'])

    const explainCall = result.toolCalls.find(
      (c) => c.toolName === 'explain_query'
    )
    expect(explainCall.input.sql).toBe(SLOW_QUERY_ROWS[0].query)

    const explainResult = result.toolResults.find(
      (r) => r.toolName === 'explain_query'
    )
    expect(explainResult.output).toEqual(EXPLAIN_ROWS)

    expect(result.text).toMatch(/PREWHERE|index/i)
    expect(result.toolCalls.every((c) => !c.invalid)).toBe(true)
    assertNoDestructiveExecution(result)
  })

  test('long-running query: recommends killing it but never auto-executes (control tools disabled)', async () => {
    const { agent, result, toolCallNames } = await runAgentScenario({
      prompt: 'Something is stuck — kill whatever is hogging the cluster.',
      turns: [
        toolCallTurn('get_running_queries', {}),
        textTurn(
          `Query ${RUNNING_QUERY_ROWS[0].query_id} (user ${RUNNING_QUERY_ROWS[0].user}) has been running for ${RUNNING_QUERY_ROWS[0].elapsed}s. Recommend: KILL QUERY WHERE query_id = '${RUNNING_QUERY_ROWS[0].query_id}'. Control actions are disabled in this environment, so please run this yourself.`
        ),
      ],
    })

    expect(toolCallNames).toEqual(['get_running_queries'])
    // The destructive tool isn't even offered in the default (self-hosted)
    // posture — it can't be "recommend and auto-run" if it was never wired.
    expect(agent.tools).not.toHaveProperty('kill_query')
    expect(result.text).toMatch(/kill/i)
    assertNoDestructiveExecution(result)
  })
})

describe('agent golden scenarios — storage & cluster health', () => {
  test('fragmented table: flags poor compression and recommends OPTIMIZE without running it', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt: 'sales.orders feels slow lately — can you check its parts?',
      turns: [
        toolCallTurn('get_table_parts', {
          database: 'sales',
          table: 'orders',
          active: true,
        }),
        textTurn(
          `sales.orders has ${FRAGMENTED_PARTS_ROWS.length} small active parts with a poor compression ratio (~0.33). Recommend running OPTIMIZE TABLE sales.orders to consolidate them — I have not run this for you.`
        ),
      ],
    })

    expect(toolCallNames).toEqual(['get_table_parts'])
    const partsResult = result.toolResults.find(
      (r) => r.toolName === 'get_table_parts'
    )
    expect(partsResult.output).toEqual(FRAGMENTED_PARTS_ROWS)
    expect(result.text).toMatch(/OPTIMIZE/)
    expect(toolCallNames).not.toContain('optimize_table')
    assertNoDestructiveExecution(result)
  })

  test('disk nearly full: surfaces low free space and recommends cleanup/TTL', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt: 'Are we running out of disk space?',
      turns: [
        toolCallTurn('get_disk_usage', {}),
        textTurn(
          `Disk "${DISK_USAGE_CRITICAL_ROWS[0].name}" has only ${DISK_USAGE_CRITICAL_ROWS[0].free_pct}% free (${DISK_USAGE_CRITICAL_ROWS[0].free} of ${DISK_USAGE_CRITICAL_ROWS[0].total}). Recommend freeing space via TTL or old partition drops soon.`
        ),
      ],
    })

    expect(toolCallNames).toEqual(['get_disk_usage'])
    const diskResult = result.toolResults.find(
      (r) => r.toolName === 'get_disk_usage'
    )
    expect(diskResult.output[0].free_pct).toBeLessThan(5)
    expect(result.text).toMatch(/free|space|TTL/i)
    assertNoDestructiveExecution(result)
  })

  test('replication lag: identifies the lagging table and its replica count', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt: 'Check replication health across the cluster.',
      turns: [
        toolCallTurn('get_replication_status', {}),
        textTurn(
          `${REPLICATION_LAG_ROWS[0].table} is lagging by ${REPLICATION_LAG_ROWS[0].absolute_delay}s with only ${REPLICATION_LAG_ROWS[0].active_replicas}/${REPLICATION_LAG_ROWS[0].total_replicas} active replicas. Investigate the down replica's network/disk I/O.`
        ),
      ],
    })

    expect(toolCallNames).toEqual(['get_replication_status'])
    const replicationResult = result.toolResults.find(
      (r) => r.toolName === 'get_replication_status'
    )
    expect(replicationResult.output[0].active_replicas).toBeLessThan(
      replicationResult.output[0].total_replicas
    )
    expect(result.text).toMatch(/lag/i)
    assertNoDestructiveExecution(result)
  })

  test('stuck merges: flags a slow-progressing merge', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt: 'Are merges keeping up on sales.orders?',
      turns: [
        toolCallTurn('get_merge_status', {}),
        textTurn(
          `One merge on ${MERGE_STATUS_ROWS[0].table} is only ${MERGE_STATUS_ROWS[0].progress_pct}% progressed after ${MERGE_STATUS_ROWS[0].elapsed}s on a ${MERGE_STATUS_ROWS[0].size} part. This is a large merge — avoid triggering additional heavy merges until it completes.`
        ),
      ],
    })

    expect(toolCallNames).toEqual(['get_merge_status'])
    const mergeResult = result.toolResults.find(
      (r) => r.toolName === 'get_merge_status'
    )
    expect(mergeResult.output).toEqual(MERGE_STATUS_ROWS)
    assertNoDestructiveExecution(result)
  })
})

describe('agent golden scenarios — errors & exploration', () => {
  test('high error rate: groups failures by exception code and points to a cause', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt: "We're seeing a lot of failed queries — what's going on?",
      turns: [
        toolCallTurn('get_failed_queries', { lastHours: 24 }),
        textTurn(
          `Both recent failures are exception_code ${FAILED_QUERY_ROWS[0].exception_code} ("${FAILED_QUERY_ROWS[0].error}") from user ${FAILED_QUERY_ROWS[0].user} — likely a bad migration or a typo'd table name. Recommend checking the ETL job's target table.`
        ),
      ],
    })

    expect(toolCallNames).toEqual(['get_failed_queries'])
    const failedResult = result.toolResults.find(
      (r) => r.toolName === 'get_failed_queries'
    )
    expect(failedResult.output).toHaveLength(FAILED_QUERY_ROWS.length)
    expect(
      failedResult.output.every(
        (row) => row.exception_code === FAILED_QUERY_ROWS[0].exception_code
      )
    ).toBe(true)
    expect(result.text).toMatch(/exception|error|fail/i)
    assertNoDestructiveExecution(result)
  })

  test('schema exploration: lists tables in a database on request', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt: 'What tables do I have in the sales database?',
      turns: [
        toolCallTurn('list_tables', { database: 'sales' }),
        textTurn(
          `The sales database has ${TABLES_ROWS.length} tables: ${TABLES_ROWS.map((t) => t.name).join(', ')}.`
        ),
      ],
    })

    expect(toolCallNames).toEqual(['list_tables'])
    const listResult = result.toolResults.find(
      (r) => r.toolName === 'list_tables'
    )
    expect(listResult.output.tables).toEqual(TABLES_ROWS)
    assertNoDestructiveExecution(result)
  })

  test('ambiguous scope: asks the user to clarify instead of guessing', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt: 'Analyze my queries.',
      turns: [
        toolCallTurn('ask_user', {
          question: 'Which time range should I analyze?',
          inputType: 'single_choice',
          options: [
            { label: 'Last hour', value: '1h' },
            { label: 'Last 24 hours', value: '24h' },
          ],
        }),
        textTurn(
          "Once you pick a range I'll pull the relevant slow/failed queries."
        ),
      ],
    })

    expect(toolCallNames).toEqual(['ask_user'])
    const askResult = result.toolResults.find((r) => r.toolName === 'ask_user')
    expect(askResult.output.awaiting_response).toBe(true)
    expect(askResult.output.inputType).toBe('single_choice')
    assertNoDestructiveExecution(result)
  })
})

describe('agent golden scenarios — planning, visualization, skills', () => {
  test('multi-step investigation: lays out a plan before acting', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt:
        'Investigate why the cluster feels slow overall — check several things.',
      turns: [
        toolCallTurn('update_plan', {
          steps: [
            { title: 'Check server health', status: 'in_progress' },
            { title: 'Check disk usage', status: 'pending' },
            { title: 'Summarize findings', status: 'pending' },
          ],
        }),
        toolCallTurn('get_metrics', {}),
        textTurn(
          `Server health looks nominal (version ${METRICS_VERSION_ROWS[0].version}); next I would check disk and merges if you want me to continue.`
        ),
      ],
    })

    expect(toolCallNames).toEqual(['update_plan', 'get_metrics'])
    const planResult = result.toolResults.find(
      (r) => r.toolName === 'update_plan'
    )
    expect(planResult.output.type).toBe('workflow_plan')
    expect(planResult.output.steps).toHaveLength(3)
    assertNoDestructiveExecution(result)
  })

  test('visualization request: returns a chart-ready config instead of raw rows', async () => {
    const sql =
      'SELECT toStartOfHour(event_time) AS hour, count() AS queries FROM system.query_log WHERE event_time > now() - INTERVAL 1 DAY GROUP BY hour ORDER BY hour'
    const { result, toolCallNames } = await runAgentScenario({
      prompt: 'Chart query volume over the last day by hour.',
      turns: [
        toolCallTurn('query_and_visualize', {
          sql,
          chartType: 'line',
          xKey: 'hour',
          yKeys: ['queries'],
        }),
        textTurn(
          'Query volume peaked at 1200/hour at midnight and has been declining since.'
        ),
      ],
    })

    expect(toolCallNames).toEqual(['query_and_visualize'])
    const vizResult = result.toolResults.find(
      (r) => r.toolName === 'query_and_visualize'
    )
    expect(vizResult.output.type).toBe('visualization')
    expect(vizResult.output.viz.chartType).toBe('line')
    expect(vizResult.output.rows).toEqual(QUERY_VOLUME_ROWS)
    assertNoDestructiveExecution(result)
  })

  test('schema-design question: loads the matching skill for expert guidance', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt: 'What ORDER BY key should I use for sales.orders?',
      turns: [
        toolCallTurn('load_skill', { name: 'schema-design-advisor' }),
        textTurn(
          'Order by a low-cardinality filter column first (e.g. order_date), then the typical WHERE/JOIN keys.'
        ),
      ],
    })

    expect(toolCallNames).toEqual(['load_skill'])
    const skillResult = result.toolResults.find(
      (r) => r.toolName === 'load_skill'
    )
    expect(skillResult.output.name).toBe('schema-design-advisor')
    expect(typeof skillResult.output.content).toBe('string')
    expect(skillResult.output.content.length).toBeGreaterThan(0)
    assertNoDestructiveExecution(result)
  })

  test('quick health check: reports version/uptime/connections as nominal', async () => {
    const { result, toolCallNames } = await runAgentScenario({
      prompt: 'Give me a quick health check.',
      turns: [
        toolCallTurn('get_metrics', {}),
        textTurn(
          `ClickHouse ${METRICS_VERSION_ROWS[0].version}, uptime ${METRICS_UPTIME_ROWS[0].uptime_seconds}s, connections nominal.`
        ),
      ],
    })

    expect(toolCallNames).toEqual(['get_metrics'])
    const metricsResult = result.toolResults.find(
      (r) => r.toolName === 'get_metrics'
    )
    // get_metrics fans out to three sub-queries internally (version, uptime,
    // system.metrics) — assert all three actually round-tripped through the
    // mocked fetchData rather than silently defaulting to [].
    expect(metricsResult.output.version).toBe(METRICS_VERSION_ROWS[0].version)
    expect(metricsResult.output.uptime_seconds).toBe(
      METRICS_UPTIME_ROWS[0].uptime_seconds
    )
    for (const row of METRICS_ROWS) {
      expect(metricsResult.output[row.metric]).toBe(row.value)
    }
    assertNoDestructiveExecution(result)
  })
})

describe('agent golden scenarios — safety net', () => {
  test('an unconfirmed destructive tool-call attempt is caught by the safety net (a real one would fail the suite)', async () => {
    const original = process.env.AGENT_ENABLE_CONTROL_TOOLS
    process.env.AGENT_ENABLE_CONTROL_TOOLS = 'true'

    try {
      const { agent, result, toolCallNames } = await runAgentScenario({
        prompt:
          "Just optimize sales.orders right now — don't ask, don't explain.",
        includeControlTools: true,
        turns: [
          toolCallTurn('optimize_table', {
            database: 'sales',
            table: 'orders',
          }),
          textTurn('Done — optimized sales.orders.'),
        ],
      })

      // Sanity: the destructive tool really was offered and really did run —
      // otherwise this test would trivially "pass" for the wrong reason.
      expect(agent.tools).toHaveProperty('optimize_table')
      expect(toolCallNames).toContain('optimize_table')
      expect(
        result.toolResults.some((r) => r.toolName === 'optimize_table')
      ).toBe(true)

      // This is the safety-net proof: every other golden in this file calls
      // assertNoDestructiveExecution() directly and would fail the suite if
      // it threw. Here we assert that it DOES throw for this trace, proving
      // the invariant is actually enforced rather than vacuously true.
      expect(() => assertNoDestructiveExecution(result)).toThrow(
        /Destructive tool\(s\) actually executed/
      )
    } finally {
      if (original === undefined) {
        delete process.env.AGENT_ENABLE_CONTROL_TOOLS
      } else {
        process.env.AGENT_ENABLE_CONTROL_TOOLS = original
      }
    }
  })
})
