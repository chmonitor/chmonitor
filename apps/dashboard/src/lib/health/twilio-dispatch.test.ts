import type { AlertPayload } from './adapters/types'
import type { ServerTwilioConfig } from './server-alert-config'

import { buildTwilioMessage } from './adapters/twilio'
import {
  dispatchTwilio,
  twilioAuthHeader,
  twilioMessagesUrl,
} from './twilio-dispatch'
import { describe, expect, test } from 'bun:test'

/** A fetch stub that records every request it was called with. */
function stubFetch(response: Response = new Response('ok', { status: 201 })) {
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

const CONFIG: ServerTwilioConfig = {
  accountSid: 'ACtest1234',
  authToken: 'secret-token',
  from: '+15557654321',
  to: ['+15551234567'],
  minSeverity: 'critical',
}

const CRITICAL: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'disk-usage',
  value: 92,
  warnThreshold: 80,
  critThreshold: 90,
  title: 'disk-usage',
  label: '92%',
  timestamp: '2026-07-02T10:00:00.000Z',
}

describe('twilioMessagesUrl', () => {
  test('puts the account SID in the Messages API path', () => {
    expect(twilioMessagesUrl('ACtest1234')).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/ACtest1234/Messages.json'
    )
  })
})

describe('twilioAuthHeader', () => {
  test('base64-encodes "AccountSid:AuthToken" as HTTP Basic auth', () => {
    const header = twilioAuthHeader('ACtest1234', 'secret-token')
    expect(header).toBe(`Basic ${btoa('ACtest1234:secret-token')}`)
    // Decodes back to the raw "sid:token" pair.
    expect(atob(header.replace('Basic ', ''))).toBe('ACtest1234:secret-token')
  })
})

describe('dispatchTwilio — send', () => {
  test('POSTs form-encoded To/From/Body with a Basic-auth header', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchTwilio(CRITICAL, CONFIG, { fetchImpl })

    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/ACtest1234/Messages.json'
    )
    expect(calls[0].init.method).toBe('POST')

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(headers.Authorization).toBe(
      `Basic ${btoa('ACtest1234:secret-token')}`
    )

    // Form-encoded (not JSON) body, unlike every other channel here.
    const body = new URLSearchParams(String(calls[0].init.body))
    expect(body.get('To')).toBe('+15551234567')
    expect(body.get('From')).toBe('+15557654321')
    expect(body.get('Body')).toBe(buildTwilioMessage(CRITICAL))
  })

  test('POSTs once per recipient when multiple numbers are configured', async () => {
    const { calls, fetchImpl } = stubFetch()
    const ok = await dispatchTwilio(
      CRITICAL,
      { ...CONFIG, to: ['+15551234567', '+15559876543'] },
      { fetchImpl }
    )

    expect(ok).toBe(true)
    expect(calls).toHaveLength(2)
    const recipients = calls.map((c) =>
      new URLSearchParams(String(c.init.body)).get('To')
    )
    expect(recipients).toEqual(['+15551234567', '+15559876543'])
  })

  test('returns true when at least one recipient succeeds', async () => {
    let call = 0
    const fetchImpl = (async () => {
      call++
      return call === 1
        ? new Response('nope', { status: 400 })
        : new Response('ok', { status: 201 })
    }) as unknown as typeof fetch

    const ok = await dispatchTwilio(
      CRITICAL,
      { ...CONFIG, to: ['+15551234567', '+15559876543'] },
      { fetchImpl }
    )

    expect(ok).toBe(true)
    expect(call).toBe(2)
  })

  test('returns false when every recipient responds non-OK, without throwing', async () => {
    const { fetchImpl } = stubFetch(new Response('nope', { status: 401 }))
    const ok = await dispatchTwilio(CRITICAL, CONFIG, { fetchImpl })
    expect(ok).toBe(false)
  })
})

describe('dispatchTwilio — fail-open', () => {
  test('returns false, never throws, when the fetch itself rejects', async () => {
    const fetchImpl = throwingFetch(new Error('network down'))
    await expect(dispatchTwilio(CRITICAL, CONFIG, { fetchImpl })).resolves.toBe(
      false
    )
  })

  test('attempts every recipient even when an earlier one throws', async () => {
    let call = 0
    const fetchImpl = (async () => {
      call++
      if (call === 1) throw new Error('network down')
      return new Response('ok', { status: 201 })
    }) as unknown as typeof fetch

    const ok = await dispatchTwilio(
      CRITICAL,
      { ...CONFIG, to: ['+15551234567', '+15559876543'] },
      { fetchImpl }
    )

    expect(ok).toBe(true)
    expect(call).toBe(2)
  })
})
