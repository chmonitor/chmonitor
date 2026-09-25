/**
 * Tests for the PeerDB agent-tool gate in createAllTools().
 *
 * `get_peerdb_mirror_status` must be ABSENT — not merely failing — unless
 * CHM_FEATURE_PEERDB_AGENT === 'true' (and the PeerDB feature itself is not
 * disabled via CHM_FEATURE_PEERDB_ENABLED=false). A regression would
 * advertise PeerDB reads to the model on a deployment whose operator only
 * enabled the UI section. Mirrors postgres-tools-gate.test.ts.
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

  test('excludes the PeerDB tool when the flag is unset', () => {
    const tools = createAllTools(0)
    for (const name of PEERDB_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('includes the PeerDB tool when CHM_FEATURE_PEERDB_AGENT=true', () => {
    process.env.CHM_FEATURE_PEERDB_AGENT = 'true'
    const tools = createAllTools(0)
    for (const name of PEERDB_TOOLS) expect(tools).toHaveProperty(name)
  })

  test('a non-"true" flag value does not enable the PeerDB tool', () => {
    process.env.CHM_FEATURE_PEERDB_AGENT = '1'
    const tools = createAllTools(0)
    for (const name of PEERDB_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('CHM_FEATURE_PEERDB_ENABLED=false keeps the tool out even when opted in', () => {
    process.env.CHM_FEATURE_PEERDB_AGENT = 'true'
    process.env.CHM_FEATURE_PEERDB_ENABLED = 'false'
    const tools = createAllTools(0)
    for (const name of PEERDB_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('the PeerDB tool is independent of the control-tool gate', () => {
    process.env.CHM_FEATURE_PEERDB_AGENT = 'true'
    const tools = createAllTools(0, false)
    for (const name of PEERDB_TOOLS) expect(tools).toHaveProperty(name)
    expect(tools).not.toHaveProperty('kill_query')
  })
})
