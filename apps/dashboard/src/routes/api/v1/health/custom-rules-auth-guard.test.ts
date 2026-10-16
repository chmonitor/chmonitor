/**
 * Owner-scoped health rule routes must reject callers that are not
 * authenticated when auth is configured, and keep working when it is not.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

let authenticated = true
let storeCalls = 0

mock.module('@/lib/auth/api-guard', () => ({
  isAuthenticatedRequest: async () => authenticated,
}))
mock.module('@/lib/health/custom-rules-auth', () => ({
  resolveCustomRuleOwnerId: async () => 'oss',
}))
mock.module('@/lib/health/custom-rules-store', () => ({
  CustomRuleStoreError: class extends Error {},
  listCustomRules: async () => {
    storeCalls++
    return []
  },
  createCustomRule: async () => {
    storeCalls++
    return {
      id: 'r1',
      name: 'n',
      metric: 'm',
      op: '>',
      warning: 1,
      critical: 2,
      enabled: true,
      createdAt: 1,
    }
  },
  deleteCustomRule: async () => {
    storeCalls++
  },
}))
mock.module('@/lib/health/check-alerts-store', () => ({
  renameCheckAlert: async () => {
    storeCalls++
    return { ok: true }
  },
  resetCheckAlert: async () => {
    storeCalls++
    return { ok: true }
  },
}))
mock.module('@/lib/health/alert-suggestions-compute', () => ({
  computeAlertSuggestions: async () => {
    storeCalls++
    return []
  },
  invalidateAlertSuggestionsCache: () => {},
}))
mock.module('@/lib/health/alert-suggestion-dismissals-store', () => ({
  SuggestionDismissalStoreError: class extends Error {},
  dismissSuggestion: async () => {
    storeCalls++
  },
}))

type Ctx = { request: Request; params: Record<string, string> }
type Handlers = Record<string, (ctx: Ctx) => Promise<Response>>

async function handlersOf(mod: string): Promise<Handlers> {
  const m = (await import(mod)) as {
    Route: { options: { server: { handlers: Handlers } } }
  }
  return m.Route.options.server.handlers
}

const get = () => new Request('http://x/api')
const del = () => new Request('http://x/api', { method: 'DELETE' })
const json = (body: unknown) =>
  new Request('http://x/api', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

const cases: Array<[string, string, () => Request, Record<string, string>]> = [
  ['./custom-rules', 'GET', get, {}],
  ['./custom-rules', 'POST', () => json({ name: 'n' }), {}],
  ['./custom-rules/$id', 'DELETE', del, { id: 'r1' }],
  [
    './check-alerts/$checkId',
    'PUT',
    () => json({ name: 'n' }),
    { checkId: 'c' },
  ],
  ['./check-alerts/$checkId', 'DELETE', del, { checkId: 'c' }],
  ['./alert-suggestions', 'GET', get, {}],
  [
    './alert-suggestions',
    'POST',
    () => json({ action: 'dismiss', key: 'k' }),
    {},
  ],
]

describe('health rule routes auth guard', () => {
  beforeEach(() => {
    authenticated = true
    storeCalls = 0
  })

  for (const [mod, method, req, params] of cases) {
    test(`${mod} ${method} rejects an unauthenticated caller before touching the store`, async () => {
      authenticated = false
      const res = await (await handlersOf(mod))[method]({
        request: req(),
        params,
      })
      expect(res.status).toBe(401)
      expect(storeCalls).toBe(0)
    })

    test(`${mod} ${method} succeeds when authenticated or auth is off`, async () => {
      const res = await (await handlersOf(mod))[method]({
        request: req(),
        params,
      })
      expect(res.status).toBeLessThan(300)
      expect(storeCalls).toBe(1)
    })
  }

  test('custom-rules metric catalog stays public', async () => {
    authenticated = false
    const res = await (await handlersOf('./custom-rules')).GET({
      request: new Request('http://x/api?catalog=1'),
      params: {},
    })
    expect(res.status).toBe(200)
  })
})
