/**
 * Sign in with AnyRouter: account sync and expiry.
 *
 * Why it matters: a signed-in chmonitor user expects the AnyRouter sign-in to
 * follow them to other devices, so a successful popup sign-in must save the
 * token to the account. And when AnyRouter rejects the token, BOTH copies must
 * go — leaving either one means every next message fails the same way.
 */

import type { UseAnyRouterTokenResult } from './use-anyrouter-token'

import {
  handleAnyRouterTokenExpired,
  isAnyRouterTokenExpiredError,
  resetAnyRouterServerStateForTests,
  useAnyRouterToken,
} from './use-anyrouter-token'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { FeaturePermissionsProvider } from '@/lib/feature-permissions/context'

const TOKEN_KEY = 'clickhouse-monitor-anyrouter-token'
const TOKEN_URL = '/api/v1/agents/anyrouter/token'

interface Call {
  url: string
  method: string
  body?: unknown
}

let calls: Call[] = []
let flagOn = true
let tokenGet: { status: number; body?: unknown } = { status: 401 }
let tokenPutStatus = 200
const realFetch = globalThis.fetch

beforeAll(() => {
  GlobalRegistrator.register({ url: 'http://localhost/' })
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await GlobalRegistrator.unregister()
})

beforeEach(() => {
  calls = []
  flagOn = true
  tokenGet = { status: 401 }
  tokenPutStatus = 200
  localStorage.removeItem(TOKEN_KEY)
  resetAnyRouterServerStateForTests()
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (url === '/api/v1/config') {
      return Response.json({
        authProvider: 'clerk',
        principal: 'anonymous',
        features: {},
        agent: { anyrouterSignin: flagOn },
      })
    }
    if (url === '/api/v1/agents/anyrouter/login') {
      return Response.json({ authorizeUrl: 'https://anyrouter.example/auth' })
    }
    if (url === TOKEN_URL && method === 'GET') {
      return Response.json(tokenGet.body ?? {}, { status: tokenGet.status })
    }
    if (url === TOKEN_URL && method === 'PUT') {
      return Response.json({}, { status: tokenPutStatus })
    }
    if (url === TOKEN_URL && method === 'DELETE') {
      return Response.json({ connected: false, expiresAt: null })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function flush() {
  const { act } = await import('react')
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

async function mountHook() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const ref: { current: UseAnyRouterTokenResult | null } = { current: null }
  function Probe() {
    ref.current = useAnyRouterToken()
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <FeaturePermissionsProvider>
        <Probe />
      </FeaturePermissionsProvider>
    )
  })
  await flush()
  return { ref, unmount: () => act(() => root.unmount()) }
}

/** Run the popup flow to a successful callback. */
async function completePopupSignIn(
  result: UseAnyRouterTokenResult,
  expiresAt: number
) {
  const popup = { closed: false, location: { href: '' }, close() {} }
  window.open = (() => popup) as unknown as typeof window.open
  const { act } = await import('react')
  await act(async () => result.signIn())
  await flush()
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'chm:anyrouter-signin',
          ok: true,
          token: 'ar-token',
          expiresAt,
        },
      })
    )
  })
  await flush()
}

describe('sign-in saves the token to the account', () => {
  test('signed in to chmonitor: PUTs the token after popup sign-in', async () => {
    const expiresAt = Date.now() + 3_600_000
    const { ref, unmount } = await mountHook()
    await completePopupSignIn(ref.current!, expiresAt)

    const put = calls.find((c) => c.url === TOKEN_URL && c.method === 'PUT')
    expect(put?.body).toEqual({ token: 'ar-token', expiresAt })
    expect(ref.current?.isSignedIn).toBe(true)
    expect(ref.current?.connectedVia).toBe('browser')
    expect(ref.current?.expiresAt).toBe(expiresAt)
    await unmount()
  })

  test('storage unavailable (503): stays signed in with the browser token', async () => {
    tokenPutStatus = 503
    const { ref, unmount } = await mountHook()
    await completePopupSignIn(ref.current!, Date.now() + 60_000)
    expect(ref.current?.isSignedIn).toBe(true)
    expect(ref.current?.error).toBeNull()
    await unmount()
  })

  test('flag off: never touches the account route', async () => {
    flagOn = false
    const { ref, unmount } = await mountHook()
    await completePopupSignIn(ref.current!, Date.now() + 60_000)
    expect(calls.some((c) => c.url === TOKEN_URL)).toBe(false)
    expect(ref.current?.isSignedIn).toBe(true)
    await unmount()
  })
})

describe('account-held token', () => {
  test('no browser token but GET says connected: shows connected, never fetches the token', async () => {
    tokenGet = { status: 200, body: { connected: true, expiresAt: 123 } }
    const { ref, unmount } = await mountHook()
    expect(ref.current?.isSignedIn).toBe(true)
    expect(ref.current?.connectedVia).toBe('account')
    expect(ref.current?.credential).toBeNull()
    expect(ref.current?.expiresAt).toBe(123)
    await unmount()
  })

  test('guest (401): not connected', async () => {
    const { ref, unmount } = await mountHook()
    expect(ref.current?.isSignedIn).toBe(false)
    await unmount()
  })
})

describe('expired token', () => {
  test('clears the browser token and DELETEs the account token', async () => {
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ token: 'old', expiresAt: Date.now() + 60_000 })
    )
    const { ref, unmount } = await mountHook()
    expect(ref.current?.isSignedIn).toBe(true)

    const { act } = await import('react')
    await act(async () => handleAnyRouterTokenExpired())
    await flush()

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(
      calls.some((c) => c.url === TOKEN_URL && c.method === 'DELETE')
    ).toBe(true)
    expect(ref.current?.isSignedIn).toBe(false)
    expect(ref.current?.expired).toBe(true)
    await unmount()
  })

  test('recognises the route error in every shape the runtime hands over', () => {
    const agentError = {
      type: 'auth_error',
      code: 'anyrouter_token_expired',
      message: 'Unauthorized',
      suggestion: 'Sign in with AnyRouter again.',
      timestamp: 1,
    }
    expect(isAnyRouterTokenExpiredError(agentError)).toBe(true)
    expect(isAnyRouterTokenExpiredError({ error: agentError })).toBe(true)
    expect(
      isAnyRouterTokenExpiredError(
        new Error(JSON.stringify({ error: agentError }))
      )
    ).toBe(true)
    expect(
      isAnyRouterTokenExpiredError({ type: 'auth_error', code: 'other' })
    ).toBe(false)
    expect(isAnyRouterTokenExpiredError(new Error('Unauthorized'))).toBe(false)
  })
})
