import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Same auth-gate mocking approach as webhook.test.ts: this route self-gates
// writes via authorizeFeatureRequest (feature 'settings', operation 'write'),
// so anonymous callers cannot trigger the outbound send. Mocked here so the
// dispatch tests below exercise config/send logic without exercising real
// auth; the gate itself is covered by the "auth gate" describe block.
let authorizeFeatureRequest = mock(
  async (
    _permission: unknown,
    _request: Request,
    _options?: { allowAgentBearerToken?: boolean }
  ): Promise<Response | null> => null
)
mock.module('@/lib/feature-permissions/server', () => ({
  getAppConfig: () => ({ authProvider: 'none' as const, features: {} }),
  _resetAppConfigCache: () => {},
  publicReadEnabled: () => true,
  authorizeFeatureRequest: (
    permission: unknown,
    request: Request,
    options?: { allowAgentBearerToken?: boolean }
  ) => authorizeFeatureRequest(permission, request, options),
}))

// getServerEmailConfig reads env directly; stub it so tests control the
// "configured" state without mutating process.env (mirrors how the route's
// only external dependencies — config + transport — are isolated below).
let emailConfig: {
  provider: 'mailgun' | 'sendgrid' | 'smtp'
  from: string
  to: readonly string[]
} | null = null
mock.module('@/lib/health/server-alert-config', () => ({
  getServerEmailConfig: () => emailConfig,
}))

// sendAlertEmail performs the real outbound fetch (Mailgun/SendGrid); stub it
// so no test hits the network. Records the config/body it was called with.
let sendResult = true
const sendCalls: unknown[] = []
mock.module('@/lib/health/email-transport', () => ({
  sendAlertEmail: async (config: unknown, body: unknown) => {
    sendCalls.push({ config, body })
    return sendResult
  },
}))

const { __handlePostForTests: handlePost } = await import('./email-test')

beforeEach(() => {
  // Default to authorized + configured + successful send so each describe
  // block only needs to override what it's testing.
  authorizeFeatureRequest = mock(async () => null)
  emailConfig = {
    provider: 'sendgrid',
    from: 'alerts@example.com',
    to: ['ops@example.com'],
  }
  sendResult = true
  sendCalls.length = 0
})

function makeRequest(): Request {
  return new Request('https://dash.example.com/api/v1/health/email-test', {
    method: 'POST',
  })
}

describe('health email test-send — auth gate', () => {
  test('anonymous is blocked, no send attempted', async () => {
    authorizeFeatureRequest = mock(
      async () => new Response(null, { status: 401 })
    )
    const res = await handlePost(makeRequest())

    expect(res.status).toBe(401)
    expect(sendCalls).toHaveLength(0)
  })

  test('authorized passes through to the send attempt', async () => {
    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    expect(sendCalls).toHaveLength(1)
  })
})

describe('health email test-send — fail-open when unconfigured', () => {
  test('returns 400 and never attempts a send when email is not configured', async () => {
    emailConfig = null
    const res = await handlePost(makeRequest())

    expect(res.status).toBe(400)
    expect(sendCalls).toHaveLength(0)
    const body = (await res.json()) as { error?: { message?: string } }
    expect(body.error?.message).toContain('not configured')
  })
})

describe('health email test-send — dispatch result', () => {
  test('returns success when sendAlertEmail resolves true', async () => {
    sendResult = true
    const res = await handlePost(makeRequest())

    expect(res.status).toBe(200)
    const body = (await res.json()) as { success?: boolean }
    expect(body.success).toBe(true)
  })

  test('returns a 502 error when sendAlertEmail resolves false (fails gracefully)', async () => {
    sendResult = false
    const res = await handlePost(makeRequest())

    expect(res.status).toBe(502)
    const body = (await res.json()) as { error?: { message?: string } }
    expect(body.error?.message).toBeDefined()
  })

  test('sends the built email body to the configured recipients', async () => {
    await handlePost(makeRequest())

    expect(sendCalls).toHaveLength(1)
    const call = sendCalls[0] as {
      config: unknown
      body: { subject: string; html: string; text: string }
    }
    expect(call.config).toEqual(emailConfig)
    expect(call.body.subject).toContain('test-alert')
    expect(call.body.subject).toContain('Test host')
  })
})
