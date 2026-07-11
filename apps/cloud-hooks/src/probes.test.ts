/**
 * Health-probe transition logic + KV-backed runProbes.
 */

import {
  diffStates,
  type KVLike,
  type ProbeResult,
  probeOne,
  runProbes,
} from './probes'
import { describe, expect, mock, test } from 'bun:test'

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
