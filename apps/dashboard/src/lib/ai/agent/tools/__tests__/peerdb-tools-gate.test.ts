/**
 * Tests for the PeerDB agent-tool gate in createAllTools().
 *
 * `get_peerdb_mirror_status` must be ABSENT — not merely failing — unless the
 * caller's integration gate (integration-tools-gate.ts, resolved by the agent
 * route) turns it on. CHM_FEATURE_PEERDB_AGENT=false and
 * CHM_FEATURE_PEERDB_ENABLED=false stay hard kill switches inside the factory.
 * Mirrors postgres-tools-gate.test.ts.
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

const PEERDB_TOOLS = ['get_peerdb_mirror_status'] as const

describe('createAllTools — PeerDB agent gate', () => {
  const originalAgent = process.env.CHM_FEATURE_PEERDB_AGENT
  const originalEnabled = process.env.CHM_FEATURE_PEERDB_ENABLED

  beforeEach(() => {
    delete process.env.CHM_FEATURE_PEERDB_AGENT
    delete process.env.CHM_FEATURE_PEERDB_ENABLED
  })

  afterEach(() => {
    if (originalAgent === undefined) {
      delete process.env.CHM_FEATURE_PEERDB_AGENT
    } else {
      process.env.CHM_FEATURE_PEERDB_AGENT = originalAgent
    }
    if (originalEnabled === undefined) {
      delete process.env.CHM_FEATURE_PEERDB_ENABLED
    } else {
      process.env.CHM_FEATURE_PEERDB_ENABLED = originalEnabled
    }
  })

  test('excludes the PeerDB tool when the caller does not turn it on', () => {
    process.env.CHM_FEATURE_PEERDB_AGENT = 'true'
    const tools = createAllTools(0)
    for (const name of PEERDB_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('includes the PeerDB tool when the caller turns it on', () => {
    const tools = createAllTools(0, false, undefined, { peerdb: true })
    for (const name of PEERDB_TOOLS) expect(tools).toHaveProperty(name)
  })

  test('CHM_FEATURE_PEERDB_AGENT=false is a kill switch even when turned on', () => {
    process.env.CHM_FEATURE_PEERDB_AGENT = 'false'
    const tools = createAllTools(0, false, undefined, { peerdb: true })
    for (const name of PEERDB_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('CHM_FEATURE_PEERDB_ENABLED=false keeps the tool out even when turned on', () => {
    process.env.CHM_FEATURE_PEERDB_ENABLED = 'false'
    const tools = createAllTools(0, false, undefined, { peerdb: true })
    for (const name of PEERDB_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('the PeerDB tool is independent of the control-tool gate', () => {
    const tools = createAllTools(0, false, undefined, { peerdb: true })
    for (const name of PEERDB_TOOLS) expect(tools).toHaveProperty(name)
    expect(tools).not.toHaveProperty('kill_query')
    expect(tools).not.toHaveProperty('run_postgres_select_query')
  })
})
