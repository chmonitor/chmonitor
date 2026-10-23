import { afterEach, describe, expect, mock, test } from 'bun:test'

mock.module('@chm/logger', () => ({
  ErrorLogger: { logWarning: mock(() => {}) },
  debug: mock(() => {}),
  error: mock(() => {}),
}))

const { postWebhook, postWebhookTarget } = await import('./webhook-post')
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('postWebhook custom-target safety', () => {
  test('forwards redirect errors and transport-owned content type', async () => {
    let requestInit: RequestInit | undefined
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      requestInit = init
      return new Response(null, { status: 204 })
    }) as typeof fetch

    const result = await postWebhook(
      'https://hooks.example.test/secret',
      { text: 'alert' },
      {
        headers: { 'X-Source': 'chmonitor' },
        redirect: 'error',
      }
    )

    expect(result).toEqual({ ok: true })
    expect(requestInit?.redirect).toBe('error')
    expect(requestInit?.headers).toEqual({
      'X-Source': 'chmonitor',
      'Content-Type': 'application/json',
    })
  })

  test('does not persist credential URLs from fetch errors', async () => {
    globalThis.fetch = (async () => {
      throw new Error(
        'failed to fetch https://hooks.example.test/private-token'
      )
    }) as typeof fetch

    const result = await postWebhook(
      'https://hooks.example.test/private-token',
      { text: 'alert' },
      { redirect: 'error' }
    )

    expect(result).toEqual({ ok: false, error: 'Webhook POST failed' })
    expect(JSON.stringify(result)).not.toContain('private-token')
  })
})

describe('postWebhook redirect default', () => {
  test('refuses redirects unless the caller opts in', async () => {
    const seen: (RequestRedirect | undefined)[] = []
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      seen.push(init?.redirect)
      return new Response(null, { status: 204 })
    }) as typeof fetch

    await postWebhook('https://hooks.example.test/a', { text: 'alert' })
    await postWebhook(
      'https://hooks.example.test/b',
      { text: 'alert' },
      { redirect: 'follow' }
    )

    expect(seen).toEqual(['error', 'follow'])
  })
})

describe('postWebhookTarget redirect policy', () => {
  test('an operator-trusted target may follow a redirect, a saved one may not', async () => {
    const seen: (RequestRedirect | undefined)[] = []
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      seen.push(init?.redirect)
      return new Response(null, { status: 204 })
    }) as typeof fetch

    await postWebhookTarget(
      { url: 'https://hooks.example.test/env', trusted: true },
      { text: 'alert' }
    )
    await postWebhookTarget(
      { url: 'https://hooks.slack.com/services/T/B/x', trusted: false },
      { text: 'alert' }
    )

    expect(seen).toEqual(['follow', 'error'])
  })
})
