// posthog-js is fetched after first paint (#perf). Events tracked before it
// loads must not be lost: they queue and flush once PostHog starts.

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'

const init = mock((_key: string, _opts: unknown) => {})
const capture = mock((_event: string, _props: unknown) => {})
const realPosthog = { ...(await import('posthog-js')) }
mock.module('posthog-js', () => ({
  default: {
    init,
    capture,
    captureException: () => {},
  },
}))

const idleTasks: Array<() => void> = []
const g = globalThis as Record<string, unknown>
const saved = {
  document: g.document,
  requestIdleCallback: g.requestIdleCallback,
  key: process.env.VITE_ANALYTICS_KEY,
}

beforeAll(() => {
  process.env.VITE_ANALYTICS_KEY = 'phc_test'
  g.document = {}
  g.requestIdleCallback = (cb: () => void) => {
    idleTasks.push(cb)
    return 1
  }
})

afterAll(() => {
  mock.module('posthog-js', () => ({ ...realPosthog }))
  g.document = saved.document
  g.requestIdleCallback = saved.requestIdleCallback
  if (saved.key === undefined) delete process.env.VITE_ANALYTICS_KEY
  else process.env.VITE_ANALYTICS_KEY = saved.key
})

describe('initAnalyticsClient', () => {
  test('waits for idle, then flushes events tracked before PostHog loaded', async () => {
    const { initAnalyticsClient, trackAnalyticsEvent } = await import(
      './analytics.client'
    )

    initAnalyticsClient()
    expect(idleTasks).toHaveLength(1)
    expect(init).not.toHaveBeenCalled()

    trackAnalyticsEvent('upgrade_click', { source: 'nav' })
    expect(capture).not.toHaveBeenCalled()

    idleTasks[0]()
    await new Promise((r) => setTimeout(r, 0))

    expect(init).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0][0]).toBe('upgrade_click')
  })
})
