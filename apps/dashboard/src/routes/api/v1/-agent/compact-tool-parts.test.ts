/**
 * Earlier turns' tool outputs are resent to the model on every later step
 * and turn. A 1000-row query result from turn 1 must not be paid for again
 * in turns 2, 3, ... — but the current turn's results must reach the model
 * whole, and the converted history must still pair each tool call with its
 * result.
 */
import {
  AGENT_MAX_HISTORICAL_TOOL_OUTPUT_BYTES,
  compactHistoricalToolParts,
} from './request-parsing'
import { describe, expect, test } from 'bun:test'
import { convertToModelMessages, type UIMessage } from 'ai'

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    query_id: `q-${i}-${'x'.repeat(24)}`,
    user: 'default',
    duration_ms: i * 3,
    read_rows: i * 1000,
  }))
}

function toolPart(id: string, output: unknown) {
  return {
    type: 'tool-query',
    toolCallId: id,
    state: 'output-available',
    input: { sql: 'SELECT * FROM system.query_log' },
    output,
  }
}

function turn(n: number, output: unknown) {
  return [
    { id: `u${n}`, role: 'user', parts: [{ type: 'text', text: `q${n}` }] },
    {
      id: `a${n}`,
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        toolPart(`call-${n}`, output),
        { type: 'text', text: `answer ${n}` },
      ],
    },
  ]
}

const toolOf = (
  msgs: ReadonlyArray<{ parts: ReadonlyArray<unknown> }>,
  i: number
) => msgs[i].parts[1] as { output: unknown; toolCallId: string; input: unknown }

describe('compactHistoricalToolParts', () => {
  test('a 500-row output from an earlier turn compacts to <= 2 KB, keeping rowCount and columns', () => {
    const msgs = [...turn(1, rows(500)), ...turn(2, rows(5)).slice(0, 1)]
    const out = compactHistoricalToolParts(msgs)
    const part = toolOf(out, 1)
    expect(bytes(part.output)).toBeLessThanOrEqual(
      AGENT_MAX_HISTORICAL_TOOL_OUTPUT_BYTES
    )
    expect(part.output).toMatchObject({
      rowCount: 500,
      columns: ['query_id', 'user', 'duration_ms', 'read_rows'],
      truncated: true,
    })
    expect(part.toolCallId).toBe('call-1')
    expect(part.input).toEqual(toolOf(msgs, 1).input)
  })

  test('the current turn (latest user message and after) is untouched', () => {
    const big = rows(500)
    const msgs = [...turn(1, rows(500)), ...turn(2, big)]
    const out = compactHistoricalToolParts(msgs)
    expect(toolOf(out, 3).output).toBe(big)
    expect(out[3]).toBe(msgs[3])
  })

  test('small earlier outputs are kept as-is', () => {
    const small = { rowCount: 2, rows: rows(2) }
    const msgs = [...turn(1, small), ...turn(2, rows(1)).slice(0, 1)]
    expect(toolOf(compactHistoricalToolParts(msgs), 1).output).toBe(small)
  })

  test('large error outputs keep their message; output-error parts are unchanged', () => {
    const errOut = {
      error: 'Code: 60. Table default.x does not exist',
      stack: 'y'.repeat(5000),
    }
    const errorPart = {
      type: 'tool-query',
      toolCallId: 'call-e',
      state: 'output-error',
      input: {},
      errorText: 'boom',
    }
    const msgs = [
      ...turn(1, errOut),
      { id: 'a1b', role: 'assistant', parts: [errorPart] },
      ...turn(2, rows(1)).slice(0, 1),
    ]
    const out = compactHistoricalToolParts(msgs)
    expect(toolOf(out, 1).output).toMatchObject({ summary: errOut.error })
    expect(out[2].parts[0]).toBe(errorPart)
  })

  test('is idempotent', () => {
    const msgs = [...turn(1, rows(500)), ...turn(2, rows(500))]
    const once = compactHistoricalToolParts(msgs)
    expect(compactHistoricalToolParts(once)).toEqual(once)
  })

  test('convertToModelMessages succeeds and keeps call/result pairing; reports bytes saved', async () => {
    const msgs = [
      ...turn(1, rows(1000)),
      ...turn(2, rows(1000)),
      ...turn(3, rows(1000)),
    ] as unknown as UIMessage[]
    const before = await convertToModelMessages(msgs)
    const after = await convertToModelMessages(compactHistoricalToolParts(msgs))
    const ids = (m: typeof after, kind: string) =>
      m.flatMap((x) =>
        Array.isArray(x.content)
          ? x.content
              .filter((c) => c.type === kind)
              .map((c) => (c as { toolCallId: string }).toolCallId)
          : []
      )
    expect(ids(after, 'tool-call')).toEqual(['call-1', 'call-2', 'call-3'])
    expect(ids(after, 'tool-result')).toEqual(['call-1', 'call-2', 'call-3'])
    const b = bytes(before)
    const a = bytes(after)
    console.log(`[compact] model-input JSON bytes: before=${b} after=${a}`)
    // Turn 3 keeps its full 1000 rows; turns 1-2 shrink to the stub.
    expect(a).toBeLessThan(b / 2.5)
  })
})
