/**
 * Tests for the agent tool-execution logging wrapper.
 *
 * Covers:
 *  - Successful execution: result is returned unchanged, log is emitted
 *  - Failed execution: error is re-thrown, error log is emitted
 *  - Sensitive args are redacted in logs
 *  - Tools without an execute function are passed through unmodified
 *  - resultCount is present for array results
 */

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { jsonSchema, type ToolExecutionOptions, type ToolSet } from 'ai'

// Stub @chm/logger before importing the module under test
const logCalls: Array<[string, unknown]> = []
const errorCalls: Array<[string, unknown, unknown]> = []

mock.module('@chm/logger', () => ({
  log: (msg: string, data: unknown) => {
    logCalls.push([msg, data])
  },
  error: (msg: string, err: unknown, ctx: unknown) => {
    errorCalls.push([msg, err, ctx])
  },
  isDebugEnabled: () => false,
}))

const { wrapToolsWithLogging } = await import('../tool-logging')

afterEach(() => {
  logCalls.length = 0
  errorCalls.length = 0
})

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal AI-SDK-compatible tool with the given execute function. */
function makeTool(
  executeFn: (input: unknown, opts: ToolExecutionOptions<unknown>) => unknown
) {
  // Construct a plain object instead of using tool() to avoid AI SDK v7's
  // NoInfer<CONTEXT> overload resolution leaving CONTEXT as a free type variable.
  return {
    description: 'test tool',
    inputSchema: jsonSchema<Record<string, unknown>>({}),
    execute: executeFn as (
      input: Record<string, unknown>,
      opts: ToolExecutionOptions<unknown>
    ) => unknown,
  }
}

const FAKE_OPTIONS: ToolExecutionOptions<unknown> = {
  toolCallId: 'call-abc-123',
  messages: [],
  context: undefined,
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('wrapToolsWithLogging — success path', () => {
  test('returns the original result unchanged', async () => {
    const tools = wrapToolsWithLogging(
      { my_tool: makeTool(async () => [{ row: 1 }, { row: 2 }]) },
      'session-1'
    )
    const result = await tools.my_tool.execute!(
      FAKE_OPTIONS.toolCallId ? {} : {},
      FAKE_OPTIONS
    )
    expect(result).toEqual([{ row: 1 }, { row: 2 }])
  })

  test('emits a structured log entry on success', async () => {
    const tools = wrapToolsWithLogging(
      { count_tool: makeTool(async () => [1, 2, 3]) },
      'session-2'
    )
    await tools.count_tool.execute!({}, FAKE_OPTIONS)

    expect(logCalls.length).toBeGreaterThanOrEqual(1)
    const [msg, data] = logCalls[logCalls.length - 1]
    expect(msg).toContain('completed')
    expect((data as Record<string, unknown>).toolName).toBe('count_tool')
    expect((data as Record<string, unknown>).traceId).toBe('call-abc-123')
    expect((data as Record<string, unknown>).conversationId).toBe('session-2')
    expect(typeof (data as Record<string, unknown>).durationMs).toBe('number')
  })

  test('includes resultCount for array results', async () => {
    const tools = wrapToolsWithLogging(
      { arr_tool: makeTool(async () => ['a', 'b', 'c']) },
      'session-3'
    )
    await tools.arr_tool.execute!({}, FAKE_OPTIONS)

    const [, data] = logCalls[logCalls.length - 1]
    expect((data as Record<string, unknown>).resultCount).toBe(3)
  })

  test('does not include resultCount for non-array scalar result', async () => {
    const tools = wrapToolsWithLogging(
      { scalar_tool: makeTool(async () => 'done') },
      'session-4'
    )
    await tools.scalar_tool.execute!({}, FAKE_OPTIONS)

    const [, data] = logCalls[logCalls.length - 1]
    expect('resultCount' in (data as Record<string, unknown>)).toBe(false)
  })
})

describe('wrapToolsWithLogging — failure path', () => {
  test('re-throws the original error', async () => {
    const boom = new Error('CH connection refused')
    const tools = wrapToolsWithLogging(
      {
        bad_tool: makeTool(async () => {
          throw boom
        }),
      },
      'session-5'
    )
    expect(() => tools.bad_tool.execute!({}, FAKE_OPTIONS)).toThrow(
      'CH connection refused'
    )
  })

  test('emits an error log on failure', async () => {
    const boom = new Error('timeout exceeded')
    const tools = wrapToolsWithLogging(
      {
        slow_tool: makeTool(async () => {
          throw boom
        }),
      },
      'session-6'
    )
    try {
      await tools.slow_tool.execute!({}, FAKE_OPTIONS)
    } catch {
      /* expected */
    }

    expect(errorCalls.length).toBeGreaterThanOrEqual(1)
  })

  test('emits execution-error log with errorCategory', async () => {
    const boom = new Error('query timed out')
    const tools = wrapToolsWithLogging(
      {
        t: makeTool(async () => {
          throw boom
        }),
      },
      'session-7'
    )
    try {
      await tools.t.execute!({}, FAKE_OPTIONS)
    } catch {
      /* expected */
    }

    const execErrorLog = logCalls.find(([msg]) =>
      String(msg).includes('execution-error')
    )
    expect(execErrorLog).toBeDefined()
    const data = execErrorLog![1] as Record<string, unknown>
    expect(data.errorCategory).toBe('timeout')
    expect(data.toolName).toBe('t')
  })
})

describe('wrapToolsWithLogging — arg redaction', () => {
  test('redacts sensitive keys in logged args', async () => {
    const tools = wrapToolsWithLogging(
      { q: makeTool(async () => []) },
      'session-8'
    )
    await tools.q.execute!(
      { password: 'secret123', user: 'alice' },
      FAKE_OPTIONS
    )

    const [, data] = logCalls[logCalls.length - 1]
    const args = (data as Record<string, unknown>).args as Record<
      string,
      unknown
    >
    expect(args.password).toBe('[REDACTED]')
    expect(args.user).toBe('alice')
  })

  test('truncates long string args', async () => {
    const tools = wrapToolsWithLogging(
      { q: makeTool(async () => []) },
      'session-9'
    )
    const longSql = 'SELECT '.repeat(100)
    await tools.q.execute!({ sql: longSql }, FAKE_OPTIONS)

    const [, data] = logCalls[logCalls.length - 1]
    const args = (data as Record<string, unknown>).args as Record<
      string,
      unknown
    >
    expect(typeof args.sql).toBe('string')
    expect((args.sql as string).length).toBeLessThan(longSql.length)
    expect(args.sql).toContain('…')
  })
})

describe('wrapToolsWithLogging — passthrough', () => {
  test('tools without execute are passed through unchanged', () => {
    const noExec = {
      description: 'no execute',
      inputSchema: jsonSchema({}),
    }
    const tools = wrapToolsWithLogging(
      { plain: noExec as unknown as ToolSet[string] },
      'session-10'
    )
    expect(tools.plain).toBe(noExec)
  })
})
