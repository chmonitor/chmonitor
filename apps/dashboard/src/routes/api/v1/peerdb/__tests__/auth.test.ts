/**
 * PeerDB routes use a server-held credential (`$`, `peerdb-status`,
 * `peerdb-metrics`, `log-patterns`) or dial a caller-supplied URL
 * (`validate`), so a signed-out caller must be rejected under Clerk + public
 * read (cloud mode). Auth `none` stays open.
 *
 * Order contract: the not-configured response comes first, so a deployment
 * without PeerDB answers every caller identically; sign-in is only checked once
 * PeerDB is configured. Uses the real isAuthenticatedRequest so a handler that
 * skips the check fails here.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { issueApiKey } from '@chm/mcp-server/auth'

const envBindings: Record<string, string | undefined> = {}
mock.module('cloudflare:workers', () => ({ env: envBindings }))

const { __handleForTests: proxy } = await import('../$')
const { __handlePostForTests: validate } = await import('../validate')
const { __handlerForTests: metrics } = await import('../../peerdb-metrics')
const { __handlerForTests: logPatterns } = await import('../log-patterns')
const { Route: statusRoute } = await import('../../peerdb-status')

const KEYS = [
  'CHM_AUTH_PROVIDER',
  'VITE_AUTH_PROVIDER',
  'CHM_CLERK_PUBLIC_READ',
  'CHM_API_KEY_SECRET',
] as const
const saved: Record<string, string | undefined> = {}
const realFetch = globalThis.fetch

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  delete envBindings.PEERDB_API_URL
  // Upstream PeerDB: an empty-but-valid JSON body for every call.
  globalThis.fetch = (async () =>
    Response.json({ mirrors: [], version: 'v0' })) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function cloudMode() {
  process.env.CHM_AUTH_PROVIDER = 'clerk'
  process.env.CHM_CLERK_PUBLIC_READ = 'true'
}

function configurePeerDB() {
  envBindings.PEERDB_API_URL = 'http://peerdb.test:8113'
}

async function signedInHeaders(): Promise<Record<string, string>> {
  process.env.CHM_API_KEY_SECRET =
    'test-secret-key-for-unit-tests-at-least-32-chars'
  return { authorization: `Bearer ${await issueApiKey('test')}` }
}

const base = 'https://dash.example.com/api/v1'
const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${base}${path}`, { headers })

interface Target {
  name: string
  call: (headers?: Record<string, string>) => Promise<Response>
  /** Status of the not-configured response for this route. */
  unconfiguredStatus: number
}

const targets: Target[] = [
  {
    name: 'proxy',
    call: (h) => proxy('GET', get('/peerdb/mirrors/list', h), 'mirrors/list'),
    unconfiguredStatus: 503,
  },
  {
    name: 'log-patterns',
    call: (h) => logPatterns(get('/peerdb/log-patterns', h)),
    unconfiguredStatus: 503,
  },
  {
    name: 'peerdb-metrics',
    call: (h) => metrics(get('/peerdb-metrics', h)),
    unconfiguredStatus: 200,
  },
  {
    name: 'peerdb-status',
    call: (h) => {
      const handlers = statusRoute.options.server?.handlers as unknown as {
        GET: (ctx: { request: Request }) => Promise<Response>
      }
      return handlers.GET({ request: get('/peerdb-status', h) })
    },
    unconfiguredStatus: 200,
  },
]

describe.each(targets)('peerdb guard: $name', (t) => {
  test('unconfigured: signed-out cloud caller gets the same response as OSS', async () => {
    const oss = await t.call()
    cloudMode()
    const cloud = await t.call()
    expect(oss.status).toBe(t.unconfiguredStatus)
    expect(cloud.status).toBe(t.unconfiguredStatus)
  })

  test('configured: signed-out cloud caller gets 401 in the shared error shape', async () => {
    configurePeerDB()
    cloudMode()
    const res = await t.call()
    expect(res.status).toBe(401)
    const body = (await res.json()) as {
      success: boolean
      error: { type: string; message: string }
    }
    expect(body.success).toBe(false)
    expect(body.error.type).toBe('permission_error')
    expect(body.error.message).toBeTruthy()
  })

  test('configured: signed-in cloud caller reaches PeerDB', async () => {
    configurePeerDB()
    cloudMode()
    const res = await t.call(await signedInHeaders())
    expect(res.status).toBe(200)
  })

  test('configured: auth none stays open', async () => {
    configurePeerDB()
    const res = await t.call()
    expect(res.status).toBe(200)
  })
})

describe('peerdb guard: validate', () => {
  const req = (headers: Record<string, string> = {}) =>
    new Request(`${base}/peerdb/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: '{}',
    })

  test('signed-out cloud caller gets 401', async () => {
    cloudMode()
    const res = await validate(req())
    expect(res.status).toBe(401)
  })

  test('signed-in cloud caller reaches the handler (no apiUrl -> 400)', async () => {
    cloudMode()
    const res = await validate(req(await signedInHeaders()))
    expect(res.status).toBe(400)
  })

  test('auth none reaches the handler (no apiUrl -> 400)', async () => {
    const res = await validate(req())
    expect(res.status).toBe(400)
  })
})
