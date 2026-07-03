import type { AlertPayload } from './adapters/types'

import { buildOpsgenieBody } from './adapters/opsgenie'
import { dispatchOpsgenie } from './opsgenie-dispatch'
import { describe, expect, test } from 'bun:test'

// Injected DNS resolver so tests never hit the network — same pattern as
// routes/api/v1/health/webhook.test.ts.
const resolvePublic = async () => ['93.184.216.34']
const resolvePrivate = async () => ['10.0.0.5']

/** A fetch stub that records the request it was called with. */
function stubFetch(response: Response = new Response('ok', { status: 200 })) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return response
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

function throwingFetch(err: unknown) {
  return (async () => {
    throw err
  }) as unknown as typeof fetch
}

const CRITICAL: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'failed-mutations',
  value: 7,
  warnThreshold: 1,
  critThreshold: 5,
  title: 'Failed mutations',
  label: '7 failed mutations',
  timestamp: '2026-07-02T10:00:00.000Z',
}

const RECOVERY: AlertPayload = {
  ...CRITICAL,
  severity: 'recovery',
  value: 0,
  label: 'recovered',
}

describe('dispatchOpsgenie — create (trigger)', () => {
  test('POSTs to the US base URL with the GenieKey header and the built body', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchOpsgenie(
      CRITICAL,
      { apiKey: 'test-key', region: 'us' },
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.opsgenie.com/v2/alerts')
    expect(calls[0].init.method).toBe('POST')
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization
    ).toBe('GenieKey test-key')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(
      buildOpsgenieBody(CRITICAL)
    )
  })

  test('uses the EU base URL when region is "eu"', async () => {
    const { calls, fetchImpl } = stubFetch()
    await dispatchOpsgenie(
      CRITICAL,
      { apiKey: 'test-key', region: 'eu' },
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(calls[0].url).toBe('https://api.eu.opsgenie.com/v2/alerts')
  })

  test('returns false when Opsgenie responds non-OK, without throwing', async () => {
    const { fetchImpl } = stubFetch(new Response('nope', { status: 401 }))
    const ok = await dispatchOpsgenie(
      CRITICAL,
      { apiKey: 'bad-key', region: 'us' },
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(ok).toBe(false)
  })
})

describe('dispatchOpsgenie — close (recovery)', () => {
  test('POSTs to the alias close endpoint with identifierType=alias', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchOpsgenie(
      RECOVERY,
      { apiKey: 'test-key', region: 'us' },
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(ok).toBe(true)
    expect(calls[0].url).toBe(
      'https://api.opsgenie.com/v2/alerts/chmonitor%3A2%3Afailed-mutations/close?identifierType=alias'
    )
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      source: 'chmonitor',
      note: buildOpsgenieBody(RECOVERY).message,
    })
  })
})

describe('dispatchOpsgenie — fail-open', () => {
  test('blocks an SSRF-unsafe resolution and returns false without fetching', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchOpsgenie(
      CRITICAL,
      { apiKey: 'test-key', region: 'us' },
      { resolveHostAddresses: resolvePrivate, fetchImpl }
    )

    expect(ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('returns false, never throws, when the fetch itself rejects', async () => {
    const fetchImpl = throwingFetch(new Error('network down'))

    await expect(
      dispatchOpsgenie(
        CRITICAL,
        { apiKey: 'test-key', region: 'us' },
        { resolveHostAddresses: resolvePublic, fetchImpl }
      )
    ).resolves.toBe(false)
  })
})
