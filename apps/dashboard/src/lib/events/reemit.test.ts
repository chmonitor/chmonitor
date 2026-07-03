/**
 * Unit tests for reemit.ts — off by default (no env var), SSRF-blocked URLs
 * never fetched, and a configured public HTTPS URL is forwarded. Mirrors the
 * deps-injection style of routes/api/v1/health/webhook.test.ts (the SSRF
 * guard this module reuses).
 */

import type { NormalizedEvent } from './types'

import { reemitEvent } from './reemit'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const resolvePublic = async () => ['93.184.216.34']
const resolvePrivate = async () => ['10.0.0.5']

const event: NormalizedEvent = {
  id: 'occurrence-1',
  source: 'generic',
  severity: 'critical',
  resource: 'ch-node-1',
  title: 'Disk usage high',
  body: 'Disk usage at 95%',
  labels: {},
  receivedAt: 1_000,
  dedupHash: 'hash-a',
}

function stubFetch(ok = true) {
  const calls: { url: string; body: string }[] = []
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') })
    return new Response(null, { status: ok ? 200 : 500 })
  }) as typeof fetch
  return { fetchImpl, calls }
}

const ORIGINAL_ENV = process.env.CHM_EVENTS_REEMIT_WEBHOOK_URL

beforeEach(() => {
  delete process.env.CHM_EVENTS_REEMIT_WEBHOOK_URL
})

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.CHM_EVENTS_REEMIT_WEBHOOK_URL
  } else {
    process.env.CHM_EVENTS_REEMIT_WEBHOOK_URL = ORIGINAL_ENV
  }
})

describe('reemitEvent', () => {
  test('is off by default (no env var configured)', async () => {
    const { fetchImpl, calls } = stubFetch()
    const sent = await reemitEvent(event, { fetchImpl })
    expect(sent).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('rejects a non-https URL without fetching', async () => {
    process.env.CHM_EVENTS_REEMIT_WEBHOOK_URL = 'http://example.com/hook'
    const { fetchImpl, calls } = stubFetch()
    const sent = await reemitEvent(event, { fetchImpl })
    expect(sent).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('blocks an SSRF-unsafe (private) destination without fetching', async () => {
    process.env.CHM_EVENTS_REEMIT_WEBHOOK_URL =
      'https://internal.example.com/hook'
    const { fetchImpl, calls } = stubFetch()
    const sent = await reemitEvent(event, {
      fetchImpl,
      resolveHostAddresses: resolvePrivate,
    })
    expect(sent).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('forwards to a configured public HTTPS URL through the SSRF guard', async () => {
    process.env.CHM_EVENTS_REEMIT_WEBHOOK_URL = 'https://hooks.example.com/x'
    const { fetchImpl, calls } = stubFetch()
    const sent = await reemitEvent(event, {
      fetchImpl,
      resolveHostAddresses: resolvePublic,
    })
    expect(sent).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://hooks.example.com/x')
    const body = JSON.parse(calls[0].body) as { text: string }
    expect(body.text).toContain('CRITICAL')
    expect(body.text).toContain('Disk usage high')
  })

  test('a failed outbound fetch is swallowed, never throws', async () => {
    process.env.CHM_EVENTS_REEMIT_WEBHOOK_URL = 'https://hooks.example.com/x'
    const throwingFetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    const sent = await reemitEvent(event, {
      fetchImpl: throwingFetch,
      resolveHostAddresses: resolvePublic,
    })
    expect(sent).toBe(false)
  })
})
