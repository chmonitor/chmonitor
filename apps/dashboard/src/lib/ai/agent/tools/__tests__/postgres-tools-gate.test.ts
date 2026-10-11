/**
 * Tests for the Postgres cross-source tool gate in createAllTools().
 *
 * The three Postgres tools (run_postgres_select_query, get_postgres_metrics,
 * list_postgres_slow_query_patterns) must be ABSENT — not merely failing —
 * unless the caller's integration gate (integration-tools-gate.ts, resolved by
 * the agent route) turns them on. A regression would advertise Postgres tools
 * to the model on a deployment where they were not resolved on.
 * CHM_FEATURE_POSTGRES_SOURCE=false stays a hard kill switch inside the
 * factory. Mirrors create-all-tools-gate.test.ts (control-tool gate).
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

  test('excludes Postgres tools when the caller does not turn them on', () => {
    process.env.CHM_FEATURE_POSTGRES_SOURCE = 'true'
    // Env alone no longer registers them: the route's resolver decides.
    const tools = createAllTools(0)
    for (const name of POSTGRES_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('includes Postgres tools when the caller turns them on', () => {
    const tools = createAllTools(0, false, undefined, { postgres: true })
    for (const name of POSTGRES_TOOLS) expect(tools).toHaveProperty(name)
  })

  test('CHM_FEATURE_POSTGRES_SOURCE=false is a kill switch even when turned on', () => {
    process.env.CHM_FEATURE_POSTGRES_SOURCE = 'false'
    const tools = createAllTools(0, false, undefined, { postgres: true })
    for (const name of POSTGRES_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('Postgres tools are independent of the control-tool gate and PeerDB', () => {
    const tools = createAllTools(0, false, undefined, { postgres: true })
    for (const name of POSTGRES_TOOLS) expect(tools).toHaveProperty(name)
    expect(tools).not.toHaveProperty('kill_query')
    expect(tools).not.toHaveProperty('get_peerdb_mirror_status')
  })
})
