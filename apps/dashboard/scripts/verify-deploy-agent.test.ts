// The agent probes must fail loudly: a stale guest default (#3545, #3581) or a
// 502 on AnyRouter sign-in (#3733) is only caught if these return ok:false.

import { GUEST_DEFAULT_AGENT_MODEL } from '../src/lib/billing/guest-ai'
import { type HttpFn, runAgentProbes } from './verify-deploy-agent'
import { describe, expect, test } from 'bun:test'

type Reply = { status: number; json?: unknown } | Error

const healthy: Record<string, Reply> = {
  '/api/v1/agents/config-check': {
    status: 200,
    json: { configured: { apiKey: true, apiBase: true } },
  },
  '/api/v1/agents/models': {
    status: 200,
    json: { models: [{ id: GUEST_DEFAULT_AGENT_MODEL }, { id: 'other' }] },
  },
  '/api/v1/agents/anyrouter/login': { status: 200, json: {} },
}

function fakeHttp(overrides: Record<string, Reply> = {}): HttpFn {
  const routes = { ...healthy, ...overrides }
  return async (path) => {
    const r = routes[path]
    if (!r) throw new Error(`unexpected path ${path}`)
    if (r instanceof Error) throw r
    return { status: r.status, text: '', json: r.json ?? null }
  }
}

const run = (o?: Record<string, Reply>) =>
  runAgentProbes(fakeHttp(o), GUEST_DEFAULT_AGENT_MODEL)

describe('runAgentProbes', () => {
  test('healthy deployment passes all three, none skipped', async () => {
    const r = await run()
    expect(r).toHaveLength(3)
    expect(r.every((p) => p.ok && !p.skipped)).toBe(true)
  })

  test('configured.apiKey=false fails config-check', async () => {
    const r = await run({
      '/api/v1/agents/config-check': {
        status: 200,
        json: { configured: { apiKey: false } },
      },
    })
    expect(r.map((p) => p.ok)).toEqual([false, true, true])
  })

  test('guest default missing from the model list fails models', async () => {
    const r = await run({
      '/api/v1/agents/models': {
        status: 200,
        json: { models: [{ id: 'anyrouter:auto' }] },
      },
    })
    expect(r.map((p) => p.ok)).toEqual([true, false, true])
    expect(r[1]?.detail).toContain(GUEST_DEFAULT_AGENT_MODEL)
  })

  test('models 500 (static fallback body) fails even if the id is listed', async () => {
    const r = await run({
      '/api/v1/agents/models': {
        status: 500,
        json: { models: [{ id: GUEST_DEFAULT_AGENT_MODEL }] },
      },
    })
    expect(r[1]?.ok).toBe(false)
  })

  test('anyrouter login 502 fails; 404 (feature off) passes', async () => {
    const bad = await run({ '/api/v1/agents/anyrouter/login': { status: 502 } })
    expect(bad.map((p) => p.ok)).toEqual([true, true, false])
    const off = await run({ '/api/v1/agents/anyrouter/login': { status: 404 } })
    expect(off[2]?.ok).toBe(true)
  })

  test('a network error is a failure, not a pass', async () => {
    const r = await run({ '/api/v1/agents/models': new Error('boom') })
    expect(r[1]?.ok).toBe(false)
  })

  test('401 is an explicit skip, never a silent pass', async () => {
    const r = await run({ '/api/v1/agents/models': { status: 401 } })
    expect(r[1]?.skipped).toBe(true)
    expect(r[1]?.detail).toContain('SKIPPED')
  })
})
