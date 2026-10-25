// Worker probes must fail loudly: a telemetry Worker that lost its D1 binding
// answers 503 on /v1/summary (#3246) while every dashboard check stays green.

import {
  type HttpFn,
  runWorkerProbes,
  workerUrls,
} from './verify-deploy-workers'
import { describe, expect, test } from 'bun:test'

type Reply = { status: number; json?: unknown } | Error

const URLS = workerUrls('https://dash.chmonitor.dev')

const healthy: Record<string, Reply> = {
  [`${URLS.mcp}/api/v1/mcp/info`]: { status: 200, json: { tools: [{}] } },
  [`${URLS.mcp}/api/mcp`]: { status: 401 },
  [`${URLS.telemetry}/health`]: { status: 200 },
  [`${URLS.telemetry}/v1/summary`]: { status: 200, json: { enabled: true } },
  [`${URLS.hooks}/healthz`]: { status: 200 },
  [`${URLS.hooks}/licenses/public`]: { status: 200, json: { licenses: [] } },
}

function fakeHttp(overrides: Record<string, Reply> = {}): HttpFn {
  const routes = { ...healthy, ...overrides }
  return async (url) => {
    const r = routes[url]
    if (!r) throw new Error(`unexpected url ${url}`)
    if (r instanceof Error) throw r
    return { status: r.status, text: '', json: r.json ?? null }
  }
}

describe('workerUrls', () => {
  test('production resolves all three workers', () => {
    expect(Object.keys(URLS).sort()).toEqual(['hooks', 'mcp', 'telemetry'])
  })

  test('preview has no cloud-hooks route', () => {
    expect(
      workerUrls('https://preview.dash.chmonitor.dev').hooks
    ).toBeUndefined()
  })

  test('an unknown base resolves nothing unless overridden', () => {
    expect(workerUrls('http://localhost:3000')).toEqual({})
    expect(workerUrls('http://localhost:3000', { hooks: 'http://h' })).toEqual({
      hooks: 'http://h',
    })
  })
})

describe('runWorkerProbes', () => {
  test('healthy deployment passes all six, none skipped', async () => {
    const r = await runWorkerProbes(URLS, fakeHttp())
    expect(r).toHaveLength(6)
    expect(r.every((p) => p.ok && !p.skipped)).toBe(true)
  })

  test('telemetry 503 on /v1/summary (lost D1 binding) fails', async () => {
    const r = await runWorkerProbes(
      URLS,
      fakeHttp({ [`${URLS.telemetry}/v1/summary`]: { status: 503 } })
    )
    const bad = r.filter((p) => !p.ok)
    expect(bad).toHaveLength(1)
    expect(bad[0]?.detail).toContain('D1 binding')
  })

  test('mcp 5xx on the anonymous endpoint fails, 401 passes', async () => {
    const r = await runWorkerProbes(
      URLS,
      fakeHttp({ [`${URLS.mcp}/api/mcp`]: { status: 502 } })
    )
    expect(r.filter((p) => !p.ok).map((p) => p.name)).toEqual([
      'mcp GET /api/mcp',
    ])
  })

  test('an unreachable worker fails', async () => {
    const r = await runWorkerProbes(
      URLS,
      fakeHttp({ [`${URLS.hooks}/healthz`]: new Error('ECONNREFUSED') })
    )
    expect(r.find((p) => p.name === 'hooks GET /healthz')?.ok).toBe(false)
  })

  test('hooks KV failure fails', async () => {
    const r = await runWorkerProbes(
      URLS,
      fakeHttp({ [`${URLS.hooks}/licenses/public`]: { status: 500 } })
    )
    expect(r.filter((p) => !p.ok)).toHaveLength(1)
  })

  test('a missing URL is an explicit SKIP, not a pass', async () => {
    const r = await runWorkerProbes({ ...URLS, hooks: undefined }, fakeHttp())
    const skipped = r.filter((p) => p.skipped)
    expect(skipped).toHaveLength(2)
    expect(skipped.every((p) => p.detail.startsWith('SKIPPED'))).toBe(true)
  })
})
