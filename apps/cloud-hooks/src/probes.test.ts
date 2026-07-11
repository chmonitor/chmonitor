/**
 * Health-probe transition logic + KV-backed runProbes.
 */

import {
  DEFAULT_TARGETS,
  diffStates,
  expectNotServerError,
  expectOk,
  type KVLike,
  type ProbeResult,
  probeD1,
  probeOne,
  runProbes,
} from './probes'
import { describe, expect, mock, test } from 'bun:test'

describe('probe target table + validators', () => {
  test('DEFAULT_TARGETS covers every Cloud surface', () => {
    const names = DEFAULT_TARGETS.map((t) => t.name)
    expect(names).toEqual([
      'dashboard',
      'dashboard-ready',
      'docs',
      'landing',
      'blog',
      'mcp',
    ])
  })

  test('mcp uses the not-5xx validator (401/405 are up, 500 is down)', () => {
    const mcp = DEFAULT_TARGETS.find((t) => t.name === 'mcp')
    expect(mcp?.validator).toBe(expectNotServerError)
    expect(expectNotServerError(new Response('', { status: 405 }))).toBe(true)
    expect(expectNotServerError(new Response('', { status: 401 }))).toBe(true)
    expect(expectNotServerError(new Response('', { status: 500 }))).toBe(false)
  })

  test('expectOk is 2xx-only', () => {
    expect(expectOk(new Response('', { status: 200 }))).toBe(true)
    expect(expectOk(new Response('', { status: 404 }))).toBe(false)
  })

  test('probeOne honors a per-target validator', async () => {
    const fetchImpl = mock(async () => new Response('', { status: 405 }))
    const res = await probeOne(
      { name: 'mcp', url: 'https://x', validator: expectNotServerError },
      fetchImpl
    )
    expect(res.state).toBe('up')
  })
})

describe('probeD1', () => {
  test('successful SELECT 1 is up', async () => {
    const db = { prepare: () => ({ first: async () => ({ ok: 1 }) }) }
    expect(await probeD1(db)).toEqual({ name: 'd1', state: 'up' })
  })

  test('a D1 error is down, not a throw', async () => {
    const db = {
      prepare: () => ({
        first: async () => {
          throw new Error('d1 unavailable')
        },
      }),
    }
    const res = await probeD1(db)
    expect(res).toMatchObject({
      name: 'd1',
      state: 'down',
      error: 'd1 unavailable',
    })
  })
})

describe('diffStates — transitions only', () => {
  const results: ProbeResult[] = [
    { name: 'dashboard', state: 'up' },
    { name: 'docs', state: 'down', status: 502 },
  ]

  test('up→down and down→up are reported; unchanged is silent', () => {
    const transitions = diffStates({ dashboard: 'up', docs: 'up' }, results)
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      name: 'docs',
      from: 'up',
      to: 'down',
    })
  })

  test('down→up is reported', () => {
    const transitions = diffStates({ dashboard: 'up', docs: 'down' }, [
      { name: 'dashboard', state: 'up' },
      { name: 'docs', state: 'up' },
    ])
    expect(transitions).toEqual([
      expect.objectContaining({ name: 'docs', from: 'down', to: 'up' }),
    ])
  })

  test('first-seen up is silent; first-seen down alerts', () => {
    const transitions = diffStates({}, results)
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      name: 'docs',
      from: 'unknown',
      to: 'down',
    })
  })

  test('no transitions when nothing changed', () => {
    expect(diffStates({ dashboard: 'up', docs: 'down' }, results)).toHaveLength(
      0
    )
  })
})

describe('probeOne', () => {
  test('2xx is up', async () => {
    const fetchImpl = mock(async () => new Response('ok', { status: 200 }))
    expect(await probeOne({ name: 'x', url: 'https://x' }, fetchImpl)).toEqual({
      name: 'x',
      state: 'up',
      status: 200,
    })
  })

  test('non-2xx is down', async () => {
    const fetchImpl = mock(async () => new Response('err', { status: 503 }))
    expect(await probeOne({ name: 'x', url: 'https://x' }, fetchImpl)).toEqual({
      name: 'x',
      state: 'down',
      status: 503,
    })
  })

  test('a network error is down, not a throw', async () => {
    const fetchImpl = mock(async () => {
      throw new Error('dns fail')
    })
    const res = await probeOne({ name: 'x', url: 'https://x' }, fetchImpl)
    expect(res.state).toBe('down')
    expect(res.error).toBe('dns fail')
  })
})

describe('runProbes — KV-backed, notify on transitions', () => {
  function makeKV(initial?: Record<string, string>): KVLike & {
    store: Map<string, string>
  } {
    const store = new Map<string, string>(Object.entries(initial ?? {}))
    return {
      store,
      async get(key) {
        return store.get(key) ?? null
      },
      async put(key, value) {
        store.set(key, value)
      },
    }
  }

  test('notifies transitions and persists new state', async () => {
    const kv = makeKV({
      'probe-state:v1': JSON.stringify({ solo: 'up' }),
    })
    const notify = mock(async () => true)
    const fetchImpl = mock(async () => new Response('x', { status: 500 }))

    const transitions = await runProbes({
      kv,
      notify,
      fetch: fetchImpl,
      targets: [{ name: 'solo', url: 'https://solo' }],
    })

    expect(transitions).toHaveLength(1)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(JSON.parse(kv.store.get('probe-state:v1') as string)).toEqual({
      solo: 'down',
    })
  })

  test('d1 dep adds a read probe and alerts when it is down', async () => {
    const notify = mock(async () => true)
    const fetchImpl = mock(async () => new Response('ok', { status: 200 }))
    const db = {
      prepare: () => ({
        first: async () => {
          throw new Error('d1 down')
        },
      }),
    }
    const transitions = await runProbes({
      kv: null,
      d1: db,
      notify,
      fetch: fetchImpl,
      targets: [{ name: 'solo', url: 'https://solo' }],
    })
    expect(transitions).toEqual([
      expect.objectContaining({ name: 'd1', to: 'down' }),
    ])
  })

  test('no KV: healthy surface stays silent (first-seen up)', async () => {
    const notify = mock(async () => true)
    const fetchImpl = mock(async () => new Response('ok', { status: 200 }))
    const transitions = await runProbes({
      kv: null,
      notify,
      fetch: fetchImpl,
      targets: [{ name: 'solo', url: 'https://solo' }],
    })
    expect(transitions).toHaveLength(0)
    expect(notify).not.toHaveBeenCalled()
  })
})
