import type { AlertPayload } from './adapters/types'

import { buildNtfyMessage } from './adapters/ntfy'
import { dispatchNtfy } from './ntfy-dispatch'
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

const CONFIG = { url: 'https://ntfy.sh/my-topic', token: 'tk_secret' }

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

describe('dispatchNtfy — send', () => {
  test('POSTs headers + plain-text body to the topic URL', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchNtfy(CRITICAL, CONFIG, { fetchImpl })

    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://ntfy.sh/my-topic')
    expect(calls[0].init.method).toBe('POST')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Title).toBe('[CRITICAL] Failed mutations')
    expect(headers.Priority).toBe('5')
    expect(headers.Tags).toBe('rotating_light')
    expect(headers.Authorization).toBe('Bearer tk_secret')
    expect(calls[0].init.body).toBe(buildNtfyMessage(CRITICAL).body)
  })

  test('omits Authorization when no token is configured', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchNtfy(
      CRITICAL,
      { url: 'https://ntfy.sh/my-topic' },
      { fetchImpl }
    )

    expect(ok).toBe(true)
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  test('sends a recovery with priority 3 + check-mark tag', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchNtfy(RECOVERY, CONFIG, { fetchImpl })

    expect(ok).toBe(true)
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Priority).toBe('3')
    expect(headers.Tags).toBe('white_check_mark')
  })

  test('returns false when ntfy responds non-OK, without throwing', async () => {
    const { fetchImpl } = stubFetch(new Response('nope', { status: 403 }))
    const ok = await dispatchNtfy(CRITICAL, CONFIG, { fetchImpl })
    expect(ok).toBe(false)
  })
})

describe('dispatchNtfy — fail-open', () => {
  test('returns false, never throws, when the fetch itself rejects', async () => {
    const fetchImpl = throwingFetch(new Error('network down'))
    await expect(dispatchNtfy(CRITICAL, CONFIG, { fetchImpl })).resolves.toBe(
      false
    )
  })
})
