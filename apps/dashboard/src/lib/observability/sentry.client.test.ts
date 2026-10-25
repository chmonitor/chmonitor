// Sentry's SDK is fetched after first paint (#perf). These tests pin the two
// promises that make that safe: nothing heavy loads before the browser is
// idle, and an error raised in that window still reaches Sentry.

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'

const init = mock(() => {})
const captureException = mock((_e: unknown, _ctx?: unknown) => {})
const realSentry = { ...(await import('@sentry/react')) }
mock.module('@sentry/react', () => ({
  init,
  captureException,
  browserTracingIntegration: () => ({ name: 'BrowserTracing' }),
}))

const idleTasks: Array<() => void> = []
const target = new EventTarget()
const g = globalThis as Record<string, unknown>
const saved = {
  document: g.document,
  window: g.window,
  requestIdleCallback: g.requestIdleCallback,
  dsn: process.env.VITE_SENTRY_DSN,
}

beforeAll(() => {
  process.env.VITE_SENTRY_DSN = 'https://key@sentry.example.com/1'
  g.document = {}
  g.window = target
  g.requestIdleCallback = (cb: () => void) => {
    idleTasks.push(cb)
    return 1
  }
})

afterAll(() => {
  mock.module('@sentry/react', () => ({ ...realSentry }))
  g.document = saved.document
  g.window = saved.window
  g.requestIdleCallback = saved.requestIdleCallback
  if (saved.dsn === undefined) delete process.env.VITE_SENTRY_DSN
  else process.env.VITE_SENTRY_DSN = saved.dsn
})

describe('initSentryClient', () => {
  test('defers the SDK to idle and replays errors raised before it loads', async () => {
    const { initSentryClient, captureClientException } = await import(
      './sentry.client'
    )

    initSentryClient()
    expect(idleTasks).toHaveLength(1)
    expect(init).not.toHaveBeenCalled()

    // A crash during first paint, before Sentry exists.
    const early = new Error('boot crash')
    const errorEvent = new Event('error') as Event & { error: unknown }
    errorEvent.error = early
    target.dispatchEvent(errorEvent)
    const boundary = new Error('boundary crash')
    captureClientException(boundary, { route: '/overview' })
    expect(captureException).not.toHaveBeenCalled()

    idleTasks[0]()
    await new Promise((r) => setTimeout(r, 0))

    expect(init).toHaveBeenCalledTimes(1)
    expect(captureException.mock.calls).toEqual([
      [early, undefined],
      [boundary, { extra: { route: '/overview' } }],
    ])

    // Sentry's own handlers own window errors now; ours must be gone.
    target.dispatchEvent(errorEvent)
    expect(captureException).toHaveBeenCalledTimes(2)

    // After load, reports go straight through.
    captureClientException(boundary)
    expect(captureException).toHaveBeenCalledTimes(3)
  })
})
