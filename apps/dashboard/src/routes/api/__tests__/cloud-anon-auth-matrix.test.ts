/**
 * Runtime companion to auth-guard-coverage.test.ts. That test proves a guard
 * is *called* in each route file; this one proves it *fires*.
 *
 * Under the hosted cloud config (apps/dashboard/.env.production plus fake
 * secrets, Clerk with public read, a D1 binding that throws when touched) it
 * sends an anonymous request to every API handler, through the same
 * `resolveApiGuard` middleware start.ts runs, and expects 401 or 403.
 *
 * A handler is discovered from the filesystem, so a new route is held to this
 * by default. A route that is public in cloud mode goes in PUBLIC with a
 * reason, and must then NOT reject the anonymous caller. A route that should
 * reject but does not goes in KNOWN_GAPS with its issue; `test.failing` keeps
 * the gap documented and fails once it is fixed, so the entry gets removed.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_ROOT = fileURLToPath(new URL('..', import.meta.url))
const ENV_PRODUCTION = fileURLToPath(
  new URL('../../../../.env.production', import.meta.url)
)

for (const line of readFileSync(ENV_PRODUCTION, 'utf8').split('\n')) {
  const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())
  if (m) process.env[m[1]] = m[2]
}
const FAKE = 'fake-secret-for-unit-tests-at-least-32-chars-long'
Object.assign(process.env, {
  CHM_CLOUD_MODE: 'true',
  CHM_AUTH_PROVIDER: 'clerk',
  CHM_CLERK_PUBLIC_READ: 'true',
  CLERK_SECRET_KEY: 'sk_test_fake',
  CLERK_PUBLISHABLE_KEY: 'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk',
  CHM_FEATURE_CONVERSATION_DB: 'true',
  CHM_FEATURE_USER_CONNECTIONS_DB: 'true',
  CHM_FEATURE_WEBHOOK_SUBSCRIPTIONS: 'true',
  // vite.config.ts derives these client flags from CHM_* at build time.
  VITE_CLOUD_MODE: 'true',
  VITE_AUTH_PROVIDER: 'clerk',
  VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_ZmFrZS5jbGVyay5hY2NvdW50cy5kZXYk',
  VITE_FEATURE_CONVERSATION_DB: 'true',
  VITE_FEATURE_POSTGRES_SOURCE: 'true',
  CHM_EVENTS_INGEST_TOKEN: FAKE,
  CLERK_WEBHOOK_SECRET: `whsec_${btoa(FAKE)}`,
  SLACK_CLIENT_ID: 'fake-client-id',
  PEERDB_API_URL: 'https://peerdb.example.com',
  CHM_EDITION: 'enterprise',
  CHM_API_KEY_SECRET: FAKE,
  CHM_USER_CONNECTIONS_ENCRYPTION_KEY: FAKE,
  CRON_SECRET: FAKE,
  SLACK_SIGNING_SECRET: FAKE,
  SLACK_CLIENT_SECRET: FAKE,
  SLACK_TOKEN_ENCRYPTION_KEY: FAKE,
  CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${btoa(FAKE)}`,
  GITHUB_WEBHOOK_SECRET: FAKE,
  POLAR_WEBHOOK_SECRET: FAKE,
})

const d1Touched = (): never => {
  throw new Error('D1 touched by an anonymous request')
}
const fakeD1 = new Proxy({}, { get: () => d1Touched })
mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => fakeD1,
    getQueue: () => null,
    getDurableObjectNamespace: () => null,
  }),
}))
globalThis.fetch = (async (url: unknown) => {
  throw new Error(`network blocked in unit test: ${String(url)}`)
}) as unknown as typeof fetch

const { resolveApiGuard } = await import('@/lib/auth/api-guard')

const STATIC = 'no user data'
const DEMO = 'public read of the demo ClickHouse host (Clerk public read)'
const GUEST_AGENT =
  'cloud guest agent on the demo host (CLOUD_GUEST_AGENT_PATHS)'
const SIGNED = 'no session; trust comes from a signature, state, or token'

/** "METHOD /path" -> why an anonymous cloud caller may use it. */
const PUBLIC: Record<string, string> = {
  'GET /api/health': STATIC,
  'GET /api/healthz': 'readiness probe',
  'GET /api/version': STATIC,
  'OPTIONS /api/mcp': 'CORS preflight',
  'GET /api/pageview': 'anonymous page-view beacon, rate limited',
  'GET /api/timezone': DEMO,
  'GET /api/events/': 'global event log of env hosts, no owner column',
  'GET /api/dashboards/share/$slug':
    'shared dashboard; the slug is the capability',
  'GET /api/v1/openapi.json': STATIC,
  'GET /api/v1/releases': STATIC,
  'GET /api/v1/mcp/info': STATIC,
  'GET /api/v1/config': STATIC,
  // 'GET /api/v1/runtime-env' was removed with the telemetry bake change: the
  // endpoint is baked at build time and nothing reads this route any more.
  'GET /api/v1/auth/cli': STATIC,
  'GET /api/v1/auth/me': "the caller's own principal, anonymous here",
  'GET /api/v1/auth/device/status': STATIC,
  'POST /api/v1/auth/device/code': 'RFC 8628 device authorization request',
  'POST /api/v1/auth/token': 'RFC 8628 token exchange',
  'GET /api/v1/agents/anyrouter/callback': SIGNED,
  'GET /api/v1/agents/anyrouter/login': GUEST_AGENT,
  'GET /api/v1/agents/config-check': GUEST_AGENT,
  'GET /api/v1/agents/models': GUEST_AGENT,
  'POST /api/v1/agent': GUEST_AGENT,
  'POST /api/v1/agent/followups': GUEST_AGENT,
  'POST /api/v1/insights/generate': 'cloud guest insights carve-out',
  'GET /api/v1/slack/oauth': SIGNED,
  'GET /api/v1/billing/usage': "the guest's own IP-keyed usage meter",
  'GET /api/v1/deployments': 'operator deploy metadata, not per-user',
  'GET /api/v1/management': STATIC,
  'GET /api/v1/conversations/backend': STATIC,
  'GET /api/v1/insights/backend': STATIC,
  'GET /api/v1/insights/status': STATIC,
  'GET /api/v1/table-availability': DEMO,
  'GET /api/v1/hosts': 'demo hosts, credentials stripped',
  'GET /api/v1/health/alert-digest': 'enabled flag and window minutes only',
  'GET /api/v1/health/alert-state': 'env-host state, no owner column',
  'GET /api/v1/health/history': 'env-host alert history, no owner column',
  'GET /api/v1/health/findings': DEMO,
  'GET /api/v1/health/snapshot': DEMO,
  'GET /api/v1/health/checks': DEMO,
  'GET /api/v1/health/custom-rules/test': DEMO,
  'GET /api/v1/health/ntfy-test': 'configured flag only',
  'GET /api/v1/health/opsgenie-test': 'configured flag only',
  'GET /api/v1/health/pushover-test': 'configured flag only',
  'GET /api/v1/health/telegram-test': 'configured flag only',
  'GET /api/v1/health/twilio-test': 'configured flag and recipient count',
  'GET /api/v1/findings': DEMO,
  'GET /api/v1/insights': DEMO,
  'GET /api/v1/insights/peerdb': DEMO,
  'GET /api/v1/insights/postgres': DEMO,
  'GET /api/v1/insights/query-patterns': DEMO,
  'GET /api/v1/insights/query-patterns/$hash': DEMO,
  'GET /api/v1/insights/weekly-report': DEMO,
  'GET /api/v1/notifications': DEMO,
  'GET /api/v1/dashboard/settings': DEMO,
  'GET /api/v1/advisor': DEMO,
  'POST /api/v1/advisor': DEMO,
  'GET /api/v1/advisor/history': DEMO,
  'GET /api/v1/advisor/tuning': DEMO,
  'GET /api/v1/charts/$name': DEMO,
  'POST /api/v1/charts/batch': DEMO,
  'GET /api/v1/cluster-counts/$key': DEMO,
  'GET /api/v1/cluster-topology': DEMO,
  'GET /api/v1/data': DEMO,
  'POST /api/v1/data': DEMO,
  'GET /api/v1/explorer/columns': DEMO,
  'GET /api/v1/explorer/databases': DEMO,
  'GET /api/v1/explorer/ddl': DEMO,
  'GET /api/v1/explorer/dependencies': DEMO,
  'GET /api/v1/explorer/indexes': DEMO,
  'GET /api/v1/explorer/preview': DEMO,
  'GET /api/v1/explorer/projections': DEMO,
  'GET /api/v1/explorer/query-log': DEMO,
  'GET /api/v1/explorer/skip-indexes': DEMO,
  'GET /api/v1/explorer/tables': DEMO,
  'GET /api/v1/host-status': DEMO,
  'GET /api/v1/menu-counts/': DEMO,
  'GET /api/v1/menu-counts/$key': DEMO,
  'GET /api/v1/metrics': DEMO,
  'GET /api/v1/overview': DEMO,
  'GET /api/v1/schema-diff': DEMO,
  'POST /api/v1/schema-diff': 'read-only compare; POST carries session tokens',
  'GET /api/v1/settings-diff': DEMO,
  'POST /api/v1/settings-diff':
    'read-only compare; POST carries session tokens',
  'GET /api/v1/tables/': DEMO,
  'GET /api/v1/tables/$name': DEMO,
  'GET /api/v1/tables/$name/filter-options': DEMO,
  'POST /api/v1/browser-connections/charts/$name':
    'cloud allows only a session token, which is the capability',
  'POST /api/v1/browser-connections/tables/$name':
    'cloud allows only a session token, which is the capability',
}

/** "METHOD /path" -> issue tracking the missing rejection. */
const KNOWN_GAPS: Record<string, string> = {}

/**
 * Routes that answer an unauthorized caller with 404 on purpose, so they do
 * not reveal whether a record exists.
 */
const HIDES_AS_404 = new Set([
  'GET /api/v1/conversations/$id',
  'PUT /api/v1/conversations/$id',
  'DELETE /api/v1/conversations/$id',
  'GET /api/v1/conversations/$id/follow-ups',
])

interface Fixture {
  params?: Record<string, string>
  body?: unknown
}

/** Inputs that pass validation, so the request reaches the auth check. */
const FIXTURES: Record<string, Fixture> = {
  'POST /api/v1/user-connections': {
    body: { name: 'a', host: 'h', user: 'u', password: '' },
  },
  'POST /api/v1/user-connections/charts/$name': {
    params: { name: 'query-count' },
    body: { connectionId: 'x' },
  },
  'POST /api/v1/user-connections/tables/$name': {
    params: { name: 'common-errors' },
    body: { connectionId: 'x' },
  },
  'POST /api/v1/webhooks/subscriptions': {
    body: { url: 'https://203.0.113.1/h', eventTypes: ['connection.created'] },
  },
  'GET /api/v1/peerdb/$': { params: { _splat: 'v1/mirrors/list' } },
  'POST /api/v1/peerdb/$': { params: { _splat: 'v1/mirrors/list' } },
}

type Handler = (ctx: {
  request: Request
  params: Record<string, string>
  context: Record<string, unknown>
}) => Promise<Response> | Response

interface Endpoint {
  key: string
  path: string
  method: string
  handler: Handler
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory())
      return entry === '__tests__' ? [] : walk(full)
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [full] : []
  })
}

async function discover(): Promise<Endpoint[]> {
  const out: Endpoint[] = []
  for (const file of walk(API_ROOT)) {
    const src = readFileSync(file, 'utf8')
    const path = /createFileRoute\(\s*['"]([^'"]+)['"]/.exec(src)?.[1]
    if (!path || !/\bhandlers\s*:/.test(src)) continue
    const mod = (await import(file)) as {
      Route?: { options?: { server?: { handlers?: unknown } } }
    }
    const handlers = mod.Route?.options?.server?.handlers
    if (!handlers || typeof handlers !== 'object')
      throw new Error(`${file}: handlers is not a method map`)
    for (const [method, handler] of Object.entries(handlers)) {
      out.push({
        key: `${method} ${path}`,
        path,
        method,
        handler: handler as Handler,
      })
    }
  }
  return out
}

function anonymousRequest({ key, path, method }: Endpoint) {
  const fixture = FIXTURES[key] ?? {}
  const params: Record<string, string> = {}
  const url = path.replace(/\$(\w*)/g, (_, name: string) => {
    const param = name || '_splat'
    params[param] = fixture.params?.[param] ?? 'x'
    return params[param]
  })
  const request = new Request(`https://dash.example.com${url}?host=0`, {
    method,
    headers: { 'content-type': 'application/json' },
    body:
      method === 'GET' || method === 'HEAD'
        ? undefined
        : JSON.stringify(fixture.body ?? {}),
  })
  return { request, params }
}

async function callAnonymously(endpoint: Endpoint): Promise<number> {
  const { request, params } = anonymousRequest(endpoint)
  const blocked = await resolveApiGuard(request.clone() as Request)
  if (blocked) return blocked.status
  try {
    const res = await endpoint.handler({ request, params, context: {} })
    return res.status
  } catch (err) {
    const status = (err as { status?: unknown }).status
    return typeof status === 'number' ? status : 500
  }
}

const rejects = (status: number) => status === 401 || status === 403

const endpoints = await discover()

describe('cloud mode, anonymous caller', () => {
  test('discovers every API handler', () => {
    expect(endpoints.length).toBeGreaterThan(150)
  })

  test('PUBLIC and KNOWN_GAPS name real handlers, once', () => {
    const keys = new Set(endpoints.map((e) => e.key))
    const stale = [
      ...Object.keys(PUBLIC),
      ...Object.keys(KNOWN_GAPS),
      ...Object.keys(FIXTURES),
      ...HIDES_AS_404,
    ].filter((k) => !keys.has(k))
    const both = Object.keys(PUBLIC).filter((k) => k in KNOWN_GAPS)
    expect({ stale, both }).toEqual({ stale: [], both: [] })
  })

  for (const endpoint of endpoints) {
    const { key } = endpoint
    const rejected = HIDES_AS_404.has(key) ? [404] : [401, 403]
    if (key in PUBLIC) {
      test(`${key} is public: ${PUBLIC[key]}`, async () => {
        expect(rejects(await callAnonymously(endpoint))).toBe(false)
      })
    } else if (key in KNOWN_GAPS) {
      test.failing(`${key} rejects anonymous (gap ${KNOWN_GAPS[key]})`, async () => {
        expect(await callAnonymously(endpoint)).toBeOneOf(rejected)
      })
    } else {
      test(`${key} rejects anonymous`, async () => {
        expect(await callAnonymously(endpoint)).toBeOneOf(rejected)
      })
    }
  }
})
