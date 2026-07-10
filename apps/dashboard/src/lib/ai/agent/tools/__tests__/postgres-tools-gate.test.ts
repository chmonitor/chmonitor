/**
 * Tests for the Postgres cross-source tool gate in createAllTools().
 *
 * The three Postgres tools (run_postgres_select_query, get_postgres_metrics,
 * list_postgres_slow_query_patterns) must be ABSENT — not merely failing —
 * unless CHM_FEATURE_POSTGRES_SOURCE === 'true'. A regression would advertise
 * Postgres tools to the model on a deployment that never enabled the source
 * engine. Mirrors create-all-tools-gate.test.ts (control-tool gate).
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

const POSTGRES_TOOLS = [
  'run_postgres_select_query',
  'get_postgres_metrics',
  'list_postgres_slow_query_patterns',
] as const

describe('createAllTools — Postgres source gate', () => {
  const original = process.env.CHM_FEATURE_POSTGRES_SOURCE

  beforeEach(() => {
    delete process.env.CHM_FEATURE_POSTGRES_SOURCE
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHM_FEATURE_POSTGRES_SOURCE
    } else {
      process.env.CHM_FEATURE_POSTGRES_SOURCE = original
    }
  })

  test('excludes Postgres tools when the flag is unset', () => {
    const tools = createAllTools(0)
    for (const name of POSTGRES_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('includes Postgres tools when CHM_FEATURE_POSTGRES_SOURCE=true', () => {
    process.env.CHM_FEATURE_POSTGRES_SOURCE = 'true'
    const tools = createAllTools(0)
    for (const name of POSTGRES_TOOLS) expect(tools).toHaveProperty(name)
  })

  test('a non-"true" flag value does not enable Postgres tools', () => {
    process.env.CHM_FEATURE_POSTGRES_SOURCE = '1'
    const tools = createAllTools(0)
    for (const name of POSTGRES_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('Postgres tools are independent of the control-tool gate', () => {
    process.env.CHM_FEATURE_POSTGRES_SOURCE = 'true'
    // includeControlTools=false, control env unset — control tools stay off,
    // Postgres tools still on.
    const tools = createAllTools(0, false)
    for (const name of POSTGRES_TOOLS) expect(tools).toHaveProperty(name)
    expect(tools).not.toHaveProperty('kill_query')
  })
})
