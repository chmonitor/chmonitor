import type { EmailBody, EmailConfig } from './adapters/email'

import { sendAlertEmail } from './email-transport'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

/**
 * Exercises the REAL `sendViaMailgun` / `sendViaSendGrid` request construction
 * (URL, auth header, body encoding) against a stubbed `fetch` — nothing here
 * is mocked at the module level, so a bug in the actual outbound request shape
 * would fail these tests (unlike the email-test.test.ts route tests, which
 * stub `sendAlertEmail` itself and so never exercise this file).
 */

const ENV_KEY = 'HEALTH_ALERT_EMAIL_PROVIDER_URL'
const originalFetch = globalThis.fetch

const BODY: EmailBody = {
  subject: '[CRITICAL] failed-mutations on prod-1',
  html: '<div>alert</div>',
  text: 'alert',
}

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

function stubFetch(response: Response | (() => Response)): {
  calls: FetchCall[]
} {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return typeof response === 'function' ? response() : response
  }) as typeof fetch
  return { calls }
}

describe('sendAlertEmail — mailgun', () => {
  let savedEnv: string | undefined

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY]
  })

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = savedEnv
    globalThis.fetch = originalFetch
  })

  const config: EmailConfig = {
    provider: 'mailgun',
    from: 'alerts@example.com',
    to: ['ops@example.com', 'oncall@example.com'],
  }

  test('POSTs to the Mailgun messages API with Basic auth and form-encoded body', async () => {
    process.env[ENV_KEY] = 'mailgun://key123@mg.example.com'
    const { calls } = stubFetch(new Response('ok', { status: 200 }))

    const ok = await sendAlertEmail(config, BODY)

    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      'https://api.mailgun.net/v3/mg.example.com/messages'
    )
    expect(calls[0].init?.method).toBe('POST')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${btoa('api:key123')}`)
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')

    const form = new URLSearchParams(calls[0].init?.body as string)
    expect(form.getAll('to')).toEqual(['ops@example.com', 'oncall@example.com'])
    expect(form.get('from')).toBe('alerts@example.com')
    expect(form.get('subject')).toBe(BODY.subject)
    expect(form.get('html')).toBe(BODY.html)
    expect(form.get('text')).toBe(BODY.text)
  })

  test('returns false and never fetches when the provider url is malformed', async () => {
    process.env[ENV_KEY] = 'mailgun://mg.example.com' // missing "key@"
    const { calls } = stubFetch(new Response('ok', { status: 200 }))

    const ok = await sendAlertEmail(config, BODY)

    expect(ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('returns false (does not throw) on a non-OK response', async () => {
    process.env[ENV_KEY] = 'mailgun://key123@mg.example.com'
    stubFetch(new Response('bad request', { status: 400 }))

    const ok = await sendAlertEmail(config, BODY)

    expect(ok).toBe(false)
  })

  test('returns false (does not throw) when fetch rejects', async () => {
    process.env[ENV_KEY] = 'mailgun://key123@mg.example.com'
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch

    const ok = await sendAlertEmail(config, BODY)

    expect(ok).toBe(false)
  })
})

describe('sendAlertEmail — sendgrid', () => {
  let savedEnv: string | undefined

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY]
  })

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = savedEnv
    globalThis.fetch = originalFetch
  })

  const config: EmailConfig = {
    provider: 'sendgrid',
    from: 'alerts@example.com',
    to: ['ops@example.com'],
  }

  test('POSTs to the SendGrid mail/send API with Bearer auth and JSON body', async () => {
    process.env[ENV_KEY] = 'sendgrid://sg-key-456'
    const { calls } = stubFetch(new Response('', { status: 202 }))

    const ok = await sendAlertEmail(config, BODY)

    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.sendgrid.com/v3/mail/send')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sg-key-456')
    expect(headers['Content-Type']).toBe('application/json')

    const payload = JSON.parse(calls[0].init?.body as string)
    expect(payload.from).toEqual({ email: 'alerts@example.com' })
    expect(payload.personalizations).toEqual([
      { to: [{ email: 'ops@example.com' }] },
    ])
    expect(payload.subject).toBe(BODY.subject)
    expect(payload.content).toEqual([
      { type: 'text/plain', value: BODY.text },
      { type: 'text/html', value: BODY.html },
    ])
  })

  test('returns false on a non-OK response without throwing', async () => {
    process.env[ENV_KEY] = 'sendgrid://sg-key-456'
    stubFetch(new Response('unauthorized', { status: 401 }))

    const ok = await sendAlertEmail(config, BODY)

    expect(ok).toBe(false)
  })
})

describe('sendAlertEmail — smtp (deferred transport)', () => {
  let savedEnv: string | undefined

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY]
  })

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = savedEnv
    globalThis.fetch = originalFetch
  })

  test('fails gracefully (returns false, never fetches) — SMTP send is not implemented yet', async () => {
    process.env[ENV_KEY] = 'smtp://user:pass@smtp.example.com:587'
    const { calls } = stubFetch(new Response('ok', { status: 200 }))

    const ok = await sendAlertEmail(
      { provider: 'smtp', from: 'alerts@example.com', to: ['ops@example.com'] },
      BODY
    )

    expect(ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('sendAlertEmail — unconfigured', () => {
  let savedEnv: string | undefined

  beforeEach(() => {
    savedEnv = process.env[ENV_KEY]
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = savedEnv
    globalThis.fetch = originalFetch
  })

  test('returns false and never fetches when the provider url env var is unset', async () => {
    const { calls } = stubFetch(new Response('ok', { status: 200 }))

    const ok = await sendAlertEmail(
      {
        provider: 'mailgun',
        from: 'alerts@example.com',
        to: ['ops@example.com'],
      },
      BODY
    )

    expect(ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
