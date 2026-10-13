import { DEFAULT_TELEMETRY_ENDPOINT } from './endpoint'
import {
  installTelemetryEventSink,
  uninstallTelemetryEventSink,
} from './event-sink'
import { getChmVersion, STORAGE_KEY_INSTANCE_ID } from './instance-ping'
import { clearTelemetrySinks, track } from './track'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'

const ENDPOINT = 'https://telemetry.example/chmonitor'
const ON = { CHM_TELEMETRY: 'on', CHM_TELEMETRY_ENDPOINT: ENDPOINT }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

interface Call {
  url: string
  body: Record<string, unknown>
}

const originalFetch = globalThis.fetch
const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage'
)
let calls: Call[]
let store: Map<string, string>

function stubGlobals() {
  calls = []
  store = new Map()
  globalThis.fetch = mock((url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) })
    return Promise.resolve(new Response(null, { status: 202 }))
  }) as unknown as typeof fetch
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  })
}

/** The sink sends asynchronously (it hashes the id first): wait for `n` POSTs. */
async function waitForCalls(n: number) {
  for (let i = 0; i < 100 && calls.length < n; i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
}

beforeEach(stubGlobals)

afterEach(() => {
  uninstallTelemetryEventSink()
  clearTelemetrySinks()
  globalThis.fetch = originalFetch
  if (originalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalStorage)
  } else {
    delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

describe('installTelemetryEventSink', () => {
  test('POSTs tracked events to the shared endpoint with the instance hash as id', async () => {
    store.set(STORAGE_KEY_INSTANCE_ID, 'example.com|default')
    installTelemetryEventSink(ON)
    track('cluster_connected', { ch_flavor: 'oss', num_hosts: 2 }, ON)
    await waitForCalls(1)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(ENDPOINT)
    // Same hash the daily ping sends as `id`: events and ping must count as
    // one user, not two.
    expect(calls[0].body).toEqual({
      event: 'cluster_connected',
      id: sha256('example.com|default'),
      version: getChmVersion(),
      props: { deploy_target: 'unknown', ch_flavor: 'oss', num_hosts: 2 },
    })
  })

  test('defaults to the same endpoint as the instance ping (no per-kind path)', async () => {
    const env = { CHM_TELEMETRY: 'on' }
    installTelemetryEventSink(env)
    track('app_loaded', {}, env)
    await waitForCalls(1)
    expect(calls[0].url).toBe(DEFAULT_TELEMETRY_ENDPOINT)
  })

  test('omits id until the ping has stored an instance id, rather than inventing one', async () => {
    installTelemetryEventSink(ON)
    track('app_loaded', {}, ON)
    await waitForCalls(1)
    expect('id' in calls[0].body).toBe(false)
  })

  test('follows the stored id when the ping regenerates it', async () => {
    installTelemetryEventSink(ON)
    store.set(STORAGE_KEY_INSTANCE_ID, 'a.example|default')
    track('health_viewed', {}, ON)
    await waitForCalls(1)
    store.set(STORAGE_KEY_INSTANCE_ID, 'a.example|ch-1')
    track('health_viewed', {}, ON)
    await waitForCalls(2)

    expect(calls.map((c) => c.body.id)).toEqual([
      sha256('a.example|default'),
      sha256('a.example|ch-1'),
    ])
  })

  test('never sends a license key, even if a caller passes one', async () => {
    const key = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    installTelemetryEventSink(ON)
    track('app_loaded', { license_key: key } as never, ON)
    await waitForCalls(1)
    expect(JSON.stringify(calls[0].body)).not.toContain(key)
    expect(JSON.stringify(calls[0].body)).not.toContain('license')
  })

  test('empty endpoint is the hard kill-switch — no sink, no POST', async () => {
    const env = { CHM_TELEMETRY: 'on', CHM_TELEMETRY_ENDPOINT: '' }
    installTelemetryEventSink(env)
    track('app_loaded', {}, env)
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toHaveLength(0)
  })

  test('no-op when telemetry is disabled — no sink, no POST', async () => {
    installTelemetryEventSink({ CHM_TELEMETRY: 'off' })
    track('app_loaded', {}, { CHM_TELEMETRY: 'off' })
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toHaveLength(0)
  })

  test('DO_NOT_TRACK wins over an enabled flag', async () => {
    const env = { ...ON, DO_NOT_TRACK: '1' }
    installTelemetryEventSink(env)
    track('app_loaded', {}, env)
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toHaveLength(0)
  })

  test('is idempotent — installing twice registers one sink', async () => {
    installTelemetryEventSink(ON)
    installTelemetryEventSink(ON)
    track('health_viewed', {}, ON)
    await waitForCalls(1)
    await new Promise((r) => setTimeout(r, 30))
    expect(calls).toHaveLength(1)
  })

  test('a failing POST never surfaces to the app', async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('offline'))
    ) as unknown as typeof fetch
    installTelemetryEventSink(ON)
    expect(() => track('app_loaded', {}, ON)).not.toThrow()
    await new Promise((r) => setTimeout(r, 30))
  })
})
