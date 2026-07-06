import { describe, expect, test } from 'bun:test'

import { agentDemoLinesForPrompt } from './agent-demo-response'

describe('agentDemoLinesForPrompt', () => {
  test('returns replication lines for lag prompts', () => {
    const lines = agentDemoLinesForPrompt('Show replication lag')
    expect(lines.some((l) => l.includes('replication_queue'))).toBe(true)
  })

  test('returns slow-query lines for performance prompts', () => {
    const lines = agentDemoLinesForPrompt('Why is this query slow?')
    expect(lines.some((l) => l.includes('query_log'))).toBe(true)
  })

  test('returns default lines for unknown prompts', () => {
    const lines = agentDemoLinesForPrompt('hello cluster')
    expect(lines.length).toBe(3)
    expect(lines[0]).toContain('query_log')
  })
})