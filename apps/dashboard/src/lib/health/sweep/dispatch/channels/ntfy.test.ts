/**
 * Send-time SSRF re-validation for saved-route ntfy targets. A topic URL that
 * passed validation at save time can resolve to an internal address later
 * (DNS rebind), so every saved target is re-checked before the request (and
 * its access token) leaves. The env-configured URL is operator-trusted.
 */

import type { FindingContext } from '../finding-context'

import { dispatchNtfyChannel } from './ntfy'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const realFetch = globalThis.fetch
let calls: { url: string; init: RequestInit }[] = []

beforeEach(() => {
  calls = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response('ok', { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

const finding = {
  hostId: 1,
  hostLabel: 'h',
  ruleId: 'rule',
  ruleTitle: 'T',
  label: 'L',
  value: 1,
  effective: 'critical',
  isRecovery: false,
  decision: { kind: 'new', notify: true, severity: 'critical' },
  text: 'x',
} as unknown as FindingContext

const GOOD = { url: 'https://93.184.216.34/topic', token: 'tk_good' }

describe('dispatchNtfyChannel send-time SSRF guard', () => {
  test.each([
    ['loopback', 'https://127.0.0.1/topic'],
    ['cloud metadata', 'https://169.254.169.254/latest'],
  ])('a saved %s target is never fetched', async (_name, url) => {
    const delivered = await dispatchNtfyChannel(
      finding,
      [{ url, token: 'tk_secret' }],
      null
    )
    expect(delivered).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('a blocked target does not stop the next target', async () => {
    const delivered = await dispatchNtfyChannel(
      finding,
      [{ url: 'https://169.254.169.254/latest', token: 'tk_secret' }, GOOD],
      null
    )
    expect(delivered).toBe(true)
    expect(calls.map((c) => c.url)).toEqual([GOOD.url])
  })

  test('saved targets never follow redirects', async () => {
    await dispatchNtfyChannel(finding, [GOOD], null)
    expect(calls[0]?.init.redirect).toBe('error')
  })

  test('the env-configured target is trusted (LAN server)', async () => {
    const env = { url: 'http://127.0.0.1:8080/alerts', token: 'tk_env' }
    const delivered = await dispatchNtfyChannel(finding, [env], { ...env })
    expect(delivered).toBe(true)
    expect(calls.map((c) => c.url)).toEqual([env.url])
  })

  test('a saved route with the env URL but another token is still checked', async () => {
    const env = { url: 'http://127.0.0.1:8080/alerts', token: 'tk_env' }
    const delivered = await dispatchNtfyChannel(
      finding,
      [{ url: env.url, token: 'tk_other' }],
      env
    )
    expect(delivered).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
