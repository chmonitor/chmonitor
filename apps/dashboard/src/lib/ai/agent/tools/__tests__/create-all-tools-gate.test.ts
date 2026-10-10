/**
 * Tests for the destructive control-tool gate in createAllTools().
 *
 * Control tools (kill_query / optimize_table / kill_mutation) must be exposed to
 * the LLM ONLY when BOTH the env var AGENT_ENABLE_CONTROL_TOOLS === 'true' AND
 * the includeControlTools argument are set. A regression in this double gate
 * would silently hand the agent cluster-mutating tools, so each combination is
 * asserted explicitly.
 *
 * Mirrors mcp-tool-adapter.test.ts setup: mock server-only + @chm/clickhouse-client
 * (the tools index pulls getClient at module-eval via findings-store).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))
mock.module('@chm/clickhouse-client', () => ({
  getClient: async () => ({
    command: async () => ({}),
    insert: async () => ({}),
    query: async () => ({ json: async () => [] }),
  }),
  fetchData: async () => ({ data: [], error: null }),
}))

const { createAllTools } = await import('../index')

const CONTROL_TOOLS = ['kill_query', 'optimize_table', 'kill_mutation'] as const

describe('createAllTools — control-tool gate', () => {
  const original = process.env.AGENT_ENABLE_CONTROL_TOOLS

  beforeEach(() => {
    delete process.env.AGENT_ENABLE_CONTROL_TOOLS
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AGENT_ENABLE_CONTROL_TOOLS
    } else {
      process.env.AGENT_ENABLE_CONTROL_TOOLS = original
    }
  })

  test('excludes control tools when includeControlTools=false and env unset', () => {
    const tools = createAllTools(0, false)
    for (const name of CONTROL_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('excludes control tools when includeControlTools=true but env unset', () => {
    const tools = createAllTools(0, true)
    for (const name of CONTROL_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('includes control tools only when env=true AND includeControlTools=true', () => {
    process.env.AGENT_ENABLE_CONTROL_TOOLS = 'true'
    const tools = createAllTools(0, true)
    for (const name of CONTROL_TOOLS) expect(tools).toHaveProperty(name)
  })

  test('excludes control tools when env=true but includeControlTools=false (arg takes priority)', () => {
    process.env.AGENT_ENABLE_CONTROL_TOOLS = 'true'
    const tools = createAllTools(0, false)
    for (const name of CONTROL_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('=1 / =yes enable control tools (shared parseBool grammar)', () => {
    for (const value of ['1', 'yes']) {
      process.env.AGENT_ENABLE_CONTROL_TOOLS = value
      const tools = createAllTools(0, true)
      for (const name of CONTROL_TOOLS) expect(tools).toHaveProperty(name)
    }
  })

  test('a junk flag value does not enable control tools', () => {
    process.env.AGENT_ENABLE_CONTROL_TOOLS = 'maybe'
    const tools = createAllTools(0, true)
    for (const name of CONTROL_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('always exposes baseline (non-control) tools regardless of gate', () => {
    const tools = createAllTools(0, false)
    // sanity: schema tool is always present
    expect(Object.keys(tools).length).toBeGreaterThan(0)
    expect(tools).toHaveProperty('list_databases')
  })
})
