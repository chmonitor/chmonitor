import { describe, expect, test } from 'bun:test'
import { parseAgentSse } from './parse-agent-sse.js'

function sse(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join('') + 'data: [DONE]\n'
}

describe('parseAgentSse', () => {
  test('joins current-SDK text-delta.delta and records tools', () => {
    const text = sse([
      { type: 'tool-input-available', toolName: 'list_databases' },
      { type: 'text-delta', id: '1', delta: 'default ' },
      { type: 'text-delta', id: '1', delta: 'has 12 tables' },
    ])
    const out = parseAgentSse(text)
    expect(out).toContain('[tool:list_databases]')
    expect(out).toContain('default has 12 tables')
    expect(out).not.toContain('[error:')
  })

  test('dedupes tool start/available events and includes tool output', () => {
    const text = sse([
      { type: 'tool-input-start', toolName: 'get_metrics' },
      { type: 'tool-input-available', toolName: 'get_metrics' },
      { type: 'tool-output-available', output: { version: '26.4.3.37' } },
    ])
    const out = parseAgentSse(text)
    expect(out.match(/\[tool:get_metrics\]/g)?.length).toBe(1)
    expect(out).toContain('[tool-output:')
    expect(out).toContain('26.4.3.37')
  })

  test('accepts legacy textDelta and tool-call events', () => {
    const text = sse([
      { type: 'tool-call', toolName: 'get_metrics' },
      { type: 'text-delta', textDelta: 'version 24.8' },
    ])
    expect(parseAgentSse(text)).toContain('[tool:get_metrics]')
    expect(parseAgentSse(text)).toContain('version 24.8')
  })

  test('surfaces stream errors', () => {
    const text = sse([{ type: 'error', errorText: 'ClickHouse timeout' }])
    expect(parseAgentSse(text)).toContain('[error:ClickHouse timeout]')
  })

  test('records usage cost when present', () => {
    const text = sse([
      { type: 'text-delta', delta: 'ok' },
      { type: 'data-usage', data: [{ estimatedCostUsd: 0.0012345 }] },
    ])
    expect(parseAgentSse(text)).toContain('[cost:$0.001234]')
  })

  test('falls back to a snippet when the body is not SSE', () => {
    expect(parseAgentSse('plain failure body')).toBe('plain failure body')
  })
})
