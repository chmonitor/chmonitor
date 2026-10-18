/**
 * Per-owner alert config must never resolve to the self-hosted single-tenant
 * owner `''` in cloud mode. A cloud caller is scoped to the owner it proves:
 * its Clerk session, or (user-scoped config only) the subject a `chm_` key
 * was issued to. Anything else is a 401. Self-hosted keeps `''`.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { issueApiKey } from '@chm/mcp-server/auth'

let clerkUserId: string | null = null
let clerkOrgId: string | null = null
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: async () => ({ userId: clerkUserId, orgId: clerkOrgId }),
}))
mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
}))

const listRoutesCalls: string[] = []
const createRouteCalls: string[] = []
mock.module('@/lib/health/alert-routing', () => ({
  listRoutes: async (ownerId: string) => {
    listRoutesCalls.push(ownerId)
    return []
  },
  createRoute: async (input: { ownerId: string }) => {
    createRouteCalls.push(input.ownerId)
    return null
  },
  deleteRoute: async () => false,
}))

class MaintenanceStoreUnavailableError extends Error {}
const windowCalls: Array<[string, string]> = []
mock.module('@/lib/health/maintenance-windows', () => ({
  MaintenanceStoreUnavailableError,
  listWindows: async (ownerId: string) => {
    windowCalls.push(['list', ownerId])
    return []
  },
  createWindow: async (input: { ownerId: string }) => {
    windowCalls.push(['create', input.ownerId])
    return { id: 'w1' }
  },
  deleteWindow: async (ownerId: string) => {
    windowCalls.push(['delete', ownerId])
    return 1
  },
}))

const { __handleGetForTests: getRoutes, __handlePostForTests: postRoute } =
  await import('../routes')
const maint = await import('../maint-windows')

const ENV = {
  CHM_CLOUD_MODE: 'true',
  CHM_AUTH_PROVIDER: 'clerk',
  CLERK_SECRET_KEY: 'sk_test_config_owner',
  CHM_API_KEY_SECRET: 'config-owner-test-secret-0123456789',
} as const
const ENV_KEYS = [
  ...Object.keys(ENV),
  'CHM_DEPLOYMENT_MODE',
  'VITE_AUTH_PROVIDER',
  'VITE_CLOUD_MODE',
]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  Object.assign(process.env, ENV)
  clerkUserId = null
  clerkOrgId = null
  listRoutesCalls.length = 0
  createRouteCalls.length = 0
  windowCalls.length = 0
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const URL_ROUTES = 'http://localhost/api/v1/health/routes'
const URL_MAINT = 'http://localhost/api/v1/health/maint-windows'

async function keyHeaders(sub: string): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await issueApiKey(sub)}` }
}

const postWindow = (headers: Record<string, string>) =>
  maint.__handlePostForTests(
    new Request(URL_MAINT, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ hostId: null, startsAt: 1, endsAt: 2 }),
    })
  )

describe('cloud: API key without a session', () => {
  test('user-scoped config resolves to the key subject, not the empty owner', async () => {
    const res = await getRoutes(
      new Request(URL_ROUTES, { headers: await keyHeaders('user_key_owner') })
    )
    expect(res.status).toBe(200)
    expect(listRoutesCalls).toEqual(['user_key_owner'])
  })

  test('user-scoped config write is rejected, nothing stored', async () => {
    const res = await postRoute(
      new Request(URL_ROUTES, {
        method: 'POST',
        headers: {
          ...(await keyHeaders('user_key_owner')),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          matchRule: '*',
          channelUrl: 'https://hooks.example.com/x',
        }),
      })
    )
    expect(res.status).toBe(401)
    expect(createRouteCalls).toEqual([])
  })

  test('a key with an empty subject is rejected', async () => {
    const res = await getRoutes(
      new Request(URL_ROUTES, { headers: await keyHeaders('') })
    )
    expect(res.status).toBe(401)
    expect(listRoutesCalls).toEqual([])
  })

  test('billing-scoped config read is rejected (keys carry no org)', async () => {
    const res = await maint.__handleGetForTests(
      new Request(URL_MAINT, { headers: await keyHeaders('user_key_owner') })
    )
    expect(res.status).toBe(401)
    expect(windowCalls).toEqual([])
  })

  test('billing-scoped config write is rejected, nothing stored', async () => {
    const res = await postWindow(await keyHeaders('user_key_owner'))
    expect(res.status).toBe(401)
    expect(windowCalls).toEqual([])
  })
})

describe('cloud: signed-in session', () => {
  test('user-scoped config resolves to the session user', async () => {
    clerkUserId = 'user_session'
    const res = await getRoutes(new Request(URL_ROUTES))
    expect(res.status).toBe(200)
    expect(listRoutesCalls).toEqual(['user_session'])
  })

  test('billing-scoped config resolves to the active org', async () => {
    clerkUserId = 'user_session'
    clerkOrgId = 'org_session'
    const res = await postWindow({})
    expect(res.status).toBe(201)
    expect(windowCalls).toEqual([['create', 'org_session']])
  })
})

describe('self-hosted', () => {
  beforeEach(() => {
    process.env.CHM_CLOUD_MODE = 'false'
    process.env.CHM_AUTH_PROVIDER = 'none'
    delete process.env.CLERK_SECRET_KEY
    delete process.env.CHM_API_KEY_SECRET
  })

  test('user-scoped config stays on the single-tenant owner', async () => {
    const res = await getRoutes(new Request(URL_ROUTES))
    expect(res.status).toBe(200)
    expect(listRoutesCalls).toEqual([''])
  })

  test('billing-scoped config stays on the single-tenant owner', async () => {
    const res = await postWindow({})
    expect(res.status).toBe(201)
    expect(windowCalls).toEqual([['create', '']])
  })
})
