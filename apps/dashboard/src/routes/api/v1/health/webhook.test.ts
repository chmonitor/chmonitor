import { beforeEach, describe, expect, mock, test } from 'bun:test'

// The health/webhook route self-gates writes via authorizeFeatureRequest
// (feature 'settings', operation 'write') so anonymous callers cannot drive
// the outbound SSRF-capable fetch. Mocked here so the SSRF/provider tests
// below exercise fetch/SSRF logic without exercising real auth; the gate
// itself is covered by the "auth gate" describe block further down.
//
// Mocks the FULL real export surface of feature-permissions/server.ts (not
// just what this file needs): bun's mock.module() registers per module
// specifier, and actions.test.ts / charts/__tests__/*.test.ts also mock this
// same specifier (with a different, partial export subset). All these files
// can run in one `bun test` process, so a superset covering every real
// export is resilient regardless of load order. Hand-written stubs (rather
// than spreading the real module, as some other files do for other
// specifiers) are required here: server.ts imports `cloudflare:workers`,
// which is unavailable outside a Worker, so importing the real module here
// would crash. Each mocked export is a stable wrapper delegating to a
// per-test `let` binding (mirrors the mock.module style in
// routes/api/v1/webhooks/polar.test.ts:21-74), so a test can flip
// `authorizeFeatureRequest` mid-file. `@tanstack/react-router`'s
// `createFileRoute` is left un-mocked — it runs for real at import time but
// route registration isn't under test here.
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

const { __handlePostForTests: handlePost } = await import('./webhook')

beforeEach(() => {
  // Default to authorized so the pre-existing SSRF/provider-forwarding tests
  // below keep passing unchanged; only the "auth gate" tests override this.
  authorizeFeatureRequest = mock(async () => null)
})

// Injected DNS resolver so tests never hit the network. A public address makes
// hostname targets resolve to a non-internal IP (allowed); tests that must be
// blocked use IP literals (blocked before DNS) or a resolver returning an
// internal address.
const resolvePublic = async () => ['93.184.216.34']
const resolvePrivate = async () => ['10.0.0.5']

function makeRequest(body: unknown): Request {
  return new Request('https://dash.example.com/api/v1/health/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A fetch stub that records the URL + body it was called with. */
function stubFetch() {
  const calls: { url: string; body: string }[] = []
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === 'string' ? init.body : '',
    })
    return new Response('ok', { status: 200 })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('health webhook proxy — SSRF hardening', () => {
  test('blocks the cloud metadata IP (169.254.169.254)', async () => {
    const { calls, fetchImpl } = stubFetch()
    const res = await handlePost(
      makeRequest({
        url: 'https://169.254.169.254/latest/meta-data/',
        text: 'hi',
      }),
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(res.status).toBe(400)
    // The outbound fetch must never run for a blocked target.
    expect(calls).toHaveLength(0)
  })

  test('blocks an RFC1918 host that resolves to a private address', async () => {
    const { calls, fetchImpl } = stubFetch()
    const res = await handlePost(
      makeRequest({ url: 'https://internal.corp.example', text: 'hi' }),
      { resolveHostAddresses: resolvePrivate, fetchImpl }
    )

    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test('blocks a raw RFC1918 IP literal (10.0.0.1)', async () => {
    const { calls, fetchImpl } = stubFetch()
    const res = await handlePost(
      makeRequest({ url: 'https://10.0.0.1/webhook', text: 'hi' }),
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test('allows a normal public HTTPS webhook and wraps text', async () => {
    const { calls, fetchImpl } = stubFetch()
    const res = await handlePost(
      makeRequest({
        url: 'https://hooks.slack.com/services/T000/B000/XXXX',
        text: 'hello world',
      }),
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://hooks.slack.com/services/T000/B000/XXXX')
    // Backward-compatible default wrapper.
    expect(JSON.parse(calls[0].body)).toEqual({
      text: 'hello world',
      content: 'hello world',
    })
  })

  test('rejects non-https URLs', async () => {
    const { calls, fetchImpl } = stubFetch()
    const res = await handlePost(
      makeRequest({ url: 'http://hooks.slack.com/x', text: 'hi' }),
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})

describe('health webhook proxy — provider verbatim forwarding', () => {
  test('forwards the payload verbatim when a provider hint is present', async () => {
    const { calls, fetchImpl } = stubFetch()
    const payload = { blocks: [{ type: 'section', text: 'custom' }] }
    const res = await handlePost(
      makeRequest({
        url: 'https://hooks.slack.com/services/T000/B000/XXXX',
        provider: 'slack',
        payload,
      }),
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    // Forwarded verbatim — NOT re-wrapped as { text, content }.
    expect(JSON.parse(calls[0].body)).toEqual(payload)
  })

  test('requires a payload when provider is set', async () => {
    const { calls, fetchImpl } = stubFetch()
    const res = await handlePost(
      makeRequest({
        url: 'https://hooks.slack.com/services/T000/B000/XXXX',
        provider: 'slack',
      }),
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})

describe('health webhook proxy — auth gate', () => {
  test('anonymous is blocked, no egress', async () => {
    authorizeFeatureRequest = mock(
      async () => new Response(null, { status: 401 })
    )
    const { calls, fetchImpl } = stubFetch()
    const res = await handlePost(
      makeRequest({ url: 'https://hooks.slack.com/x', text: 'hi' }),
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(res.status).toBe(401)
    // The outbound fetch must never run for an unauthorized caller.
    expect(calls).toHaveLength(0)
  })

  test('authorized passes through to the outbound fetch', async () => {
    authorizeFeatureRequest = mock(async () => null)
    const { calls, fetchImpl } = stubFetch()
    const res = await handlePost(
      makeRequest({ url: 'https://hooks.slack.com/x', text: 'hi' }),
      { resolveHostAddresses: resolvePublic, fetchImpl }
    )

    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://hooks.slack.com/x')
  })
})
