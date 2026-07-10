import { mimeToStream, SENTRY_ALERT_MIME } from './__fixtures__/sentry-alert'
import worker from './index'
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Minimal env that satisfies all required config fields.
 * BUG_ALLOWED_SENDERS is the explicit "*" opt-out so tests unrelated to the
 * allowlist itself (happy path, recipient guard, misconfiguration) aren't
 * affected by the fail-closed default — see the dedicated "sender allowlist"
 * describe block below for allowlist-specific behavior.
 */
const FULL_ENV = {
  BUG_HANDLER_TARGET_ADDRESS: 'bug@chmonitor.dev',
  GITHUB_REPOSITORY: 'chmonitor/chmonitor',
  GITHUB_TOKEN: 'ghp_testtoken',
  BUG_ISSUE_LABELS: 'bug,sentry,automated',
  BUG_ISSUE_ASSIGNEES: 'duyetbot',
  BUG_ISSUE_TITLE_PREFIX: '[Sentry] ',
  BUG_ALLOWED_SENDERS: '*',
  GITHUB_API_BASE: 'https://api.github.com',
}

/** Build a minimal ForwardableEmailMessage that worker.email() can consume */
function makeMessage(
  to: string,
  from: string,
  rawMime: string
): ForwardableEmailMessage {
  return {
    to,
    from,
    raw: mimeToStream(rawMime),
    rawSize: rawMime.length,
    headers: new Headers(),
    // Email Worker methods we don't use in these tests
    forward: async () => {},
    reply: async () => {},
    setReject: () => {},
  } as unknown as ForwardableEmailMessage
}

/** A minimal ExecutionContext stub */
function makeCtx(): ExecutionContext {
  return {
    waitUntil: (p: Promise<unknown>) => {
      // drive the promise in the test — we await it via the spy below
      p.catch(() => {})
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext
}

// ─── Mock fetch ───────────────────────────────────────────────────────────────

type FetchCall = {
  url: string
  method: string
  body: Record<string, unknown>
  headers: Record<string, string>
}

function makeMockFetch(
  status = 201,
  responseBody = {
    html_url: 'https://github.com/chmonitor/chmonitor/issues/99',
  }
) {
  const calls: FetchCall[] = []

  const mockFetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const body = JSON.parse((init?.body as string) ?? '{}')
    calls.push({
      url: input.toString(),
      method: init?.method ?? 'GET',
      body,
      headers: Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {})
      ),
    })
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return { mockFetch, calls }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('worker.email — happy path', () => {
  let originalFetch: typeof globalThis.fetch
  let calls: FetchCall[]

  beforeEach(() => {
    originalFetch = globalThis.fetch
    const mock = makeMockFetch()
    calls = mock.calls
    globalThis.fetch = mock.mockFetch as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('creates exactly one GitHub issue POST for a valid Sentry alert', async () => {
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const ctx = makeCtx()

    // We need to wait for waitUntil promises — patch ctx to collect them
    const pending: Promise<unknown>[] = []
    ctx.waitUntil = (p: Promise<unknown>) => {
      pending.push(p)
    }

    await worker.email(message, FULL_ENV, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe(
      'https://api.github.com/repos/chmonitor/chmonitor/issues'
    )
  })

  it('sends the correct owner/repo in the URL', async () => {
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, FULL_ENV, ctx)
    await Promise.all(pending)

    expect(calls[0].url).toContain('/repos/chmonitor/chmonitor/issues')
  })

  it('sends the configured labels', async () => {
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, FULL_ENV, ctx)
    await Promise.all(pending)

    expect(calls[0].body.labels).toEqual(['bug', 'sentry', 'automated'])
  })

  it('sends the configured assignees', async () => {
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, FULL_ENV, ctx)
    await Promise.all(pending)

    expect(calls[0].body.assignees).toEqual(['duyetbot'])
  })

  it('includes the Sentry issue URL in the issue body', async () => {
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, FULL_ENV, ctx)
    await Promise.all(pending)

    const body = calls[0].body.body as string
    expect(body).toContain('https://chmonitor.sentry.io/issues/4567890/')
  })

  it('sends the correct Authorization header', async () => {
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, FULL_ENV, ctx)
    await Promise.all(pending)

    expect(calls[0].headers.Authorization).toBe('Bearer ghp_testtoken')
  })
})

describe('worker.email — recipient guard', () => {
  let originalFetch: typeof globalThis.fetch
  let calls: FetchCall[]

  beforeEach(() => {
    originalFetch = globalThis.fetch
    const mock = makeMockFetch()
    calls = mock.calls
    globalThis.fetch = mock.mockFetch as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('does not create an issue when message.to does not match targetAddress', async () => {
    const message = makeMessage(
      'other@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, FULL_ENV, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(0)
  })

  it('accepts any recipient when BUG_HANDLER_TARGET_ADDRESS is unset', async () => {
    const env = { ...FULL_ENV, BUG_HANDLER_TARGET_ADDRESS: undefined }
    const message = makeMessage(
      'anything@example.com',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, env, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(1)
  })
})

describe('worker.email — sender allowlist', () => {
  let originalFetch: typeof globalThis.fetch
  let calls: FetchCall[]
  let consoleWarnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    const mock = makeMockFetch()
    calls = mock.calls
    globalThis.fetch = mock.mockFetch as typeof fetch
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    consoleWarnSpy.mockRestore()
  })

  it('blocks a sender not in the allowlist and logs sender + subject', async () => {
    const env = { ...FULL_ENV, BUG_ALLOWED_SENDERS: '@sentry.io' }
    const message = makeMessage(
      'bug@chmonitor.dev',
      'spam@evil.com',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, env, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(0)
    expect(consoleWarnSpy).toHaveBeenCalled()
    const msg = (consoleWarnSpy.mock.calls[0] as string[])[0] as string
    expect(msg).toContain('spam@evil.com')
    expect(msg).toContain('TypeError')
  })

  it('allows a sender that matches the allowlist domain', async () => {
    const env = { ...FULL_ENV, BUG_ALLOWED_SENDERS: '@sentry.io' }
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, env, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(1)
  })

  it('falls back to the built-in Sentry default when BUG_ALLOWED_SENDERS is unset, allowing a Sentry sender', async () => {
    const env = { ...FULL_ENV, BUG_ALLOWED_SENDERS: undefined }
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, env, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(1)
  })

  it('falls back to the built-in Sentry default when BUG_ALLOWED_SENDERS is unset, rejecting a non-Sentry sender', async () => {
    const env = { ...FULL_ENV, BUG_ALLOWED_SENDERS: undefined }
    const message = makeMessage(
      'bug@chmonitor.dev',
      'spam@evil.com',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, env, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(0)
  })

  it('rejects every sender when BUG_ALLOWED_SENDERS is explicitly empty', async () => {
    const env = { ...FULL_ENV, BUG_ALLOWED_SENDERS: '' }
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, env, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(0)
  })

  it('allows any sender when BUG_ALLOWED_SENDERS is "*"', async () => {
    const env = { ...FULL_ENV, BUG_ALLOWED_SENDERS: '*' }
    const message = makeMessage(
      'bug@chmonitor.dev',
      'anyone@example.com',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, env, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(1)
  })
})

describe('worker.email — misconfiguration', () => {
  let originalFetch: typeof globalThis.fetch
  let calls: FetchCall[]
  let consoleErrorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    originalFetch = globalThis.fetch
    const mock = makeMockFetch()
    calls = mock.calls
    globalThis.fetch = mock.mockFetch as typeof fetch
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    consoleErrorSpy.mockRestore()
  })

  it('does not call fetch and logs an error when GITHUB_TOKEN is missing', async () => {
    const env = { ...FULL_ENV, GITHUB_TOKEN: undefined }
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, env, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(0)
    expect(consoleErrorSpy).toHaveBeenCalled()
    const msg = (consoleErrorSpy.mock.calls[0] as string[])[0] as string
    expect(msg).toContain('GITHUB_TOKEN')
  })

  it('does not call fetch and logs an error when GITHUB_REPOSITORY is missing', async () => {
    const env = { ...FULL_ENV, GITHUB_REPOSITORY: undefined }
    const message = makeMessage(
      'bug@chmonitor.dev',
      'alerts@sentry.io',
      SENTRY_ALERT_MIME
    )
    const pending: Promise<unknown>[] = []
    const ctx = {
      ...makeCtx(),
      waitUntil: (p: Promise<unknown>) => {
        pending.push(p)
      },
    } as unknown as ExecutionContext

    await worker.email(message, env, ctx)
    await Promise.all(pending)

    expect(calls).toHaveLength(0)
    expect(consoleErrorSpy).toHaveBeenCalled()
    const msg = (consoleErrorSpy.mock.calls[0] as string[])[0] as string
    expect(msg).toContain('GITHUB_REPOSITORY')
  })
})
