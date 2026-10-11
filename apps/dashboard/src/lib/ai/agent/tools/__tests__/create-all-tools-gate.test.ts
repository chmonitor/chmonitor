/**
 * Tests for the destructive control-tool gate.
 *
 * Control tools (kill_query / optimize_table / kill_mutation) are decided ONCE,
 * per request, by resolveControlToolsEnabled() (../../control-tools-gate.ts),
 * and handed to createAllTools() as `includeControlTools`. This file asserts
 * the whole chain: the resolver's {oss, cloud} x {auth none, clerk signed-in,
 * clerk anon} x {unset, true, false} matrix, and that the tool list follows it.
 * An anonymous cloud visitor must never get a write tool, whatever the flag.
 *
 * Mirrors mcp-tool-adapter.test.ts setup: mock server-only + @chm/clickhouse-client
 * (the tools index pulls getClient at module-eval via findings-store).
 */

import { describe, expect, mock, test } from 'bun:test'

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
const { resolveControlToolsEnabled } = await import('../../control-tools-gate')

const CONTROL_TOOLS = ['kill_query', 'optimize_table', 'kill_mutation'] as const

type Caller = 'auth none' | 'clerk signed-in' | 'clerk anon'
const CALLERS: Record<
  Caller,
  { authProvider: 'none' | 'clerk'; signedIn: boolean }
> = {
  'auth none': { authProvider: 'none', signedIn: false },
  'clerk signed-in': { authProvider: 'clerk', signedIn: true },
  'clerk anon': { authProvider: 'clerk', signedIn: false },
}

// [mode, caller, flag, expected]
const MATRIX: Array<['oss' | 'cloud', Caller, string | undefined, boolean]> = [
  // Self-hosted: on by default unless the caller is an anonymous Clerk visitor.
  ['oss', 'auth none', undefined, true],
  ['oss', 'auth none', 'true', true],
  ['oss', 'auth none', 'false', false],
  ['oss', 'clerk signed-in', undefined, true],
  ['oss', 'clerk signed-in', 'true', true],
  ['oss', 'clerk signed-in', 'false', false],
  ['oss', 'clerk anon', undefined, false],
  // Explicit true on OSS wins here; the route's `actions` permission check
  // still refuses an anonymous Clerk caller when writes require sign-in.
  ['oss', 'clerk anon', 'true', true],
  ['oss', 'clerk anon', 'false', false],
  // Cloud: off by default; explicit true only for a signed-in caller.
  // `auth none` in cloud has no identity, so it counts as anonymous.
  ['cloud', 'auth none', undefined, false],
  ['cloud', 'auth none', 'true', false],
  ['cloud', 'auth none', 'false', false],
  ['cloud', 'clerk signed-in', undefined, false],
  ['cloud', 'clerk signed-in', 'true', true],
  ['cloud', 'clerk signed-in', 'false', false],
  ['cloud', 'clerk anon', undefined, false],
  ['cloud', 'clerk anon', 'true', false],
  ['cloud', 'clerk anon', 'false', false],
]

describe('resolveControlToolsEnabled + createAllTools — control-tool gate', () => {
  for (const [mode, caller, flag, expected] of MATRIX) {
    test(`${mode} / ${caller} / flag=${flag ?? 'unset'} -> ${expected ? 'on' : 'off'}`, () => {
      const enabled = resolveControlToolsEnabled({
        flag,
        cloud: mode === 'cloud',
        ...CALLERS[caller],
      })
      expect(enabled).toBe(expected)
      const tools = createAllTools(0, enabled)
      for (const name of CONTROL_TOOLS) {
        if (expected) expect(tools).toHaveProperty(name)
        else expect(tools).not.toHaveProperty(name)
      }
    })
  }

  test('an anonymous cloud visitor never gets control tools, for any flag value', () => {
    for (const flag of [undefined, '', 'true', '1', 'yes', 'on', 'false']) {
      for (const authProvider of [
        'none',
        'clerk',
        'trusted',
        'proxy',
      ] as const) {
        expect(
          resolveControlToolsEnabled({
            flag,
            cloud: true,
            authProvider,
            signedIn: false,
          })
        ).toBe(false)
      }
    }
  })

  test('the flag uses the shared parseBool grammar; junk falls back to the default', () => {
    const oss = { cloud: false, authProvider: 'none' as const, signedIn: false }
    for (const flag of ['1', 'yes', 'on']) {
      expect(resolveControlToolsEnabled({ ...oss, flag })).toBe(true)
    }
    for (const flag of ['0', 'no', 'off']) {
      expect(resolveControlToolsEnabled({ ...oss, flag })).toBe(false)
    }
    // Junk is not an explicit value: self-hosted default (on), cloud default (off).
    expect(resolveControlToolsEnabled({ ...oss, flag: 'maybe' })).toBe(true)
    expect(
      resolveControlToolsEnabled({
        flag: 'maybe',
        cloud: true,
        authProvider: 'clerk',
        signedIn: true,
      })
    ).toBe(false)
  })

  test('AGENT_ENABLE_CONTROL_TOOLS=false is a hard kill switch inside createAllTools', () => {
    const original = process.env.AGENT_ENABLE_CONTROL_TOOLS
    process.env.AGENT_ENABLE_CONTROL_TOOLS = 'false'
    try {
      const tools = createAllTools(0, true)
      for (const name of CONTROL_TOOLS) expect(tools).not.toHaveProperty(name)
    } finally {
      if (original === undefined) delete process.env.AGENT_ENABLE_CONTROL_TOOLS
      else process.env.AGENT_ENABLE_CONTROL_TOOLS = original
    }
  })

  test('createAllTools omits control tools when the argument is omitted', () => {
    const tools = createAllTools(0)
    for (const name of CONTROL_TOOLS) expect(tools).not.toHaveProperty(name)
    expect(tools).toHaveProperty('list_databases')
  })
})
