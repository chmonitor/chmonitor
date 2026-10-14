/**
 * Structural hunt for API route handlers that ship without an auth guard.
 *
 * Every `server.handlers` route under `routes/api/` must be covered by one of:
 *  1. the global `/api/v1/*` middleware (`resolveApiGuard` in start.ts), for
 *     read-only (GET) handlers on non-exempt v1 paths;
 *  2. a recognized guard referenced in the route file (see GUARDS);
 *  3. an entry in PUBLIC_ROUTES (intentionally public, with a reason),
 *     READ_ONLY_POSTS (v1 POST that only reads), or KNOWN_GAPS (looks
 *     unguarded, tracked for follow-up).
 *
 * Mutating handlers (POST/PUT/PATCH/DELETE) on v1 paths still need a route
 * guard: in Clerk public-read mode the middleware passes every /api/v1/*
 * request and defers write enforcement to the route.
 *
 * Granularity is per file, not per handler: a file that references a guard
 * anywhere counts for all its handlers. See .claude/skills/api-self-audit.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_ROOT = fileURLToPath(new URL('..', import.meta.url))
const API_GUARD_FILE = fileURLToPath(
  new URL('../../../lib/auth/api-guard.ts', import.meta.url)
)

/**
 * Identifiers that reject an unauthenticated or unauthorized caller.
 * Identity resolvers are included only because they throw/401 when there is
 * no signed-in user (fail closed); check that before adding a new one.
 */
const GUARDS = [
  // lib/auth/api-guard.ts
  'enforceAuth',
  'isAuthenticatedRequest',
  'hasValidChmApiKey',
  // lib/feature-permissions/server.ts
  'authorizeFeatureRequest',
  // lib/auth/agent-api-auth.ts, insights-api-auth.ts
  'authorizeAgentApiRequest',
  'authorizeInsightsGenerateRequest',
  // lib/cron/authorize-cron.ts (Bearer CRON_SECRET)
  'authorizeCronRequest',
  // shared-secret / signature checks
  'secretsMatch',
  'authorizeIngest',
  'verifyWebhook',
  'verifyGithubSignature',
  'readAndVerifySlackRequest',
  'validateEvent', // @polar-sh/sdk webhook signature
  'verifyOAuthState',
  // @chm/mcp-server/http (defaultAuthenticator)
  'handleMcp',
  // auth provider session check (clerk / proxy)
  'authenticateRequest',
  // fail-closed identity resolvers
  'resolveUserId',
  'resolveDashboardOwnerId',
  'resolveConnectionUserId',
  'resolveAlertRoutingOwnerId',
  'resolveCustomRuleOwnerId',
  'resolveBillingOwner',
  'resolveBillingOwnerId',
  'resolveSubscriptionUserId',
  'resolveRegistryUserId',
  'resolveAgentUserId',
  'resolveOwnerId',
  'requireWriteAccess',
] as const

const GUARD_RE = new RegExp(`\\b(${GUARDS.join('|')})\\b`)

/** Route path -> why it is intentionally reachable without a guard. */
const PUBLIC_ROUTES: Record<string, string> = {
  '/api/healthz': 'liveness probe, static response, no data',
  '/api/version': 'build version for the client update check',
  '/api/dashboards/share/$slug':
    'public read of a shared dashboard; the unguessable slug is the capability',
  '/api/v1/openapi.json': 'public API discovery document (middleware-exempt)',
  '/api/v1/releases': 'public changelog from GitHub release notes',
  '/api/v1/mcp/info': 'static MCP tool/resource metadata, no secrets',
  '/api/v1/auth/cli': 'CLI auth discovery metadata (middleware-exempt)',
  '/api/v1/auth/device/code':
    'RFC 8628 device authorization request; issues an unapproved code',
  '/api/v1/auth/device/status':
    'RFC 8628 polling; the device code itself is the credential',
  '/api/v1/auth/token':
    'RFC 8628 token exchange; only an approved device code yields a key',
}

/**
 * /api/v1 POST handlers that only read (POST carries a body, not a write), so
 * the middleware covers them exactly like a GET.
 */
const READ_ONLY_POSTS: Record<string, string> = {
  '/api/v1/schema-diff':
    'read-only catalog compare; POST carries session tokens',
  '/api/v1/settings-diff':
    'read-only settings compare; POST carries session tokens',
}

/**
 * Route path -> tracking reference. These look unguarded and need a decision
 * (guard or move to PUBLIC_ROUTES). Listed so the gap stays visible.
 */
const KNOWN_GAPS: Record<string, string> = {
  '/api/v1/browser-connections/test':
    'TODO(issue): needs auth decision, see auth-guard-coverage PR',
  '/api/v1/browser-connections/sessions':
    'TODO(issue): needs auth decision, see auth-guard-coverage PR',
  '/api/v1/peerdb/validate':
    'TODO(issue): needs auth decision, see auth-guard-coverage PR',
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

interface RouteFile {
  file: string
  path: string
  methods: string[]
  src: string
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue
      out.push(...walk(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

function loadRoutes(): RouteFile[] {
  const routes: RouteFile[] = []
  for (const file of walk(API_ROOT)) {
    const src = readFileSync(file, 'utf8')
    const path = /createFileRoute\(\s*['"]([^'"]+)['"]/.exec(src)?.[1]
    const handlersAt = src.search(/\bhandlers\s*:/)
    if (!path || handlersAt < 0) continue
    const body = src.slice(handlersAt)
    const methods = METHODS.filter((m) =>
      new RegExp(`(^|[\\s{,])${m}\\s*[:(]`, 'm').test(body)
    )
    if (methods.length === 0) continue
    routes.push({ file: file.slice(API_ROOT.length), path, methods, src })
  }
  return routes
}

/** /api/v1 paths the middleware lets through; their handlers own auth. */
function middlewareExemptPaths(): Set<string> {
  const src = readFileSync(API_GUARD_FILE, 'utf8')
  return new Set(
    [...src.matchAll(/const \w+_PATH = '(\/api\/v1\/[^']+)'/g)].map((m) => m[1])
  )
}

function needsRouteGuard(route: RouteFile, exempt: Set<string>): boolean {
  const middlewareCovered =
    route.path.startsWith('/api/v1/') && !exempt.has(route.path)
  if (!middlewareCovered) return true
  if (route.path in READ_ONLY_POSTS) return false
  return route.methods.some((m) => MUTATING.has(m))
}

describe('API auth guard coverage', () => {
  const routes = loadRoutes()
  const exempt = middlewareExemptPaths()
  const byPath = new Map(routes.map((r) => [r.path, r]))

  test('discovers route handlers and middleware exemptions', () => {
    expect(routes.length).toBeGreaterThan(100)
    expect(exempt.has('/api/v1/openapi.json')).toBe(true)
  })

  test('every handler is guarded, middleware-covered, or allowlisted', () => {
    const offenders = routes.filter(
      (r) =>
        needsRouteGuard(r, exempt) &&
        !GUARD_RE.test(r.src) &&
        !(r.path in PUBLIC_ROUTES) &&
        !(r.path in KNOWN_GAPS)
    )
    if (offenders.length > 0) {
      throw new Error(
        'API routes with no recognized auth guard. Add a guard, or list the ' +
          'route in PUBLIC_ROUTES with a reason (see the api-self-audit ' +
          `skill):\n  ${offenders
            .map((r) => `${r.path} [${r.methods.join(',')}] ${r.file}`)
            .join('\n  ')}`
      )
    }
    expect(offenders).toHaveLength(0)
  })

  test('allowlist entries are real, unguarded, and justified', () => {
    const stale: string[] = []
    for (const [path, reason] of Object.entries(READ_ONLY_POSTS)) {
      const route = byPath.get(path)
      if (!route) stale.push(`${path}: no such route`)
      else if (route.methods.some((m) => m !== 'GET' && m !== 'POST'))
        stale.push(`${path}: has a write verb, cannot be read-only`)
      if (reason.trim().length < 10) stale.push(`${path}: reason too short`)
    }
    for (const [path, reason] of Object.entries({
      ...PUBLIC_ROUTES,
      ...KNOWN_GAPS,
    })) {
      const route = byPath.get(path)
      if (!route) stale.push(`${path}: no such route`)
      else if (!needsRouteGuard(route, exempt))
        stale.push(`${path}: covered by middleware, remove entry`)
      else if (GUARD_RE.test(route.src))
        stale.push(`${path}: now references a guard, remove entry`)
      if (reason.trim().length < 10) stale.push(`${path}: reason too short`)
    }
    expect(stale).toEqual([])
  })

  test('allowlists do not overlap', () => {
    const keys = [PUBLIC_ROUTES, KNOWN_GAPS, READ_ONLY_POSTS].flatMap((o) =>
      Object.keys(o)
    )
    const both = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(both).toEqual([])
  })
})
