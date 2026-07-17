import type { AlertPayload } from './adapters/types'

import { buildPushoverBody } from './adapters/pushover'
import { dispatchPushover, PUSHOVER_MESSAGES_API_URL } from './pushover-dispatch'
import { describe, expect, test } from 'bun:test'

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

const CONFIG = { token: 'app_tok', user: 'usr_key' }

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

describe('dispatchPushover — send', () => {
  test('POSTs the built JSON body to the Messages API', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchPushover(CRITICAL, CONFIG, { fetchImpl })

    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(PUSHOVER_MESSAGES_API_URL)
    expect(calls[0].init.method).toBe('POST')
    expect(
      (calls[0].init.headers as Record<string, string>)['Content-Type']
    ).toBe('application/json')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(
      buildPushoverBody(CRITICAL, CONFIG)
    )
  })

  test('sends a recovery with priority -1', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchPushover(RECOVERY, CONFIG, { fetchImpl })

    expect(ok).toBe(true)
    const body = JSON.parse(String(calls[0].init.body)) as { priority: string }
    expect(body.priority).toBe('-1')
  })

  test('returns false when Pushover responds non-OK, without throwing', async () => {
    const { fetchImpl } = stubFetch(new Response('nope', { status: 400 }))
    const ok = await dispatchPushover(CRITICAL, CONFIG, { fetchImpl })
    expect(ok).toBe(false)
  })
})

describe('dispatchPushover — fail-open', () => {
  test('returns false, never throws, when the fetch itself rejects', async () => {
    const fetchImpl = throwingFetch(new Error('network down'))
    await expect(
      dispatchPushover(CRITICAL, CONFIG, { fetchImpl })
    ).resolves.toBe(false)
  })
})
