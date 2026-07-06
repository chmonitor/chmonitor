/**
 * TanStack Start server configuration.
 *
 * Registers the global request middleware that ports the Next.js
 * `apps/dashboard/middleware.ts` security posture (#1397): API-key auth for
 * `/api/v1/*` routes and the cloud→dash 301 redirect. See
 * `@/lib/auth/api-guard` for the ported logic and the rationale for what is
 * (and is not) reproduced from the Next middleware.
 *
 * The `tanstackStart()` vite plugin auto-discovers this file by convention.
 * `requestMiddleware` runs for EVERY request (server routes, SSR, server
 * functions), so it can return a 401/redirect Response before any `/api/v1/*`
 * handler executes — matching how Next middleware intercepted the request.
 */

import { createMiddleware, createStart } from '@tanstack/react-start'

import { env } from 'cloudflare:workers'
import { setVersionCacheL2Provider } from '@chm/clickhouse-client/clickhouse-version'
import { setTableExistenceL2Provider } from '@chm/clickhouse-client/table-existence-cache'
import { clerkMiddleware } from '@clerk/tanstack-react-start/server'
import { wrapRequestHandler } from '@sentry/cloudflare'
import { SKILLS } from '@/lib/ai/agent/skills/registry'
import { captureServerException } from '@/lib/analytics/analytics.server'
import {
  bridgeApiKeyEnv,
  bridgePublicReadEnv,
  resolveApiGuard,
} from '@/lib/auth/api-guard'
import { isClerkAuthProvider } from '@/lib/auth/provider'
import { resolveServerSentryOptions } from '@/lib/observability/sentry.server'
import { forceFlushOtel, getOtelTracer } from '@/lib/otel/exporter'
import { withSpan } from '@/lib/otel/with-span'
import { withSecurityHeaders } from '@/lib/security-headers'
import { getTableExistenceCache } from '@/lib/table-existence-kv-cache'
import {
  CHM_VERSION_CACHE_KV_BINDING,
  getVersionCache,
} from '@/lib/version-cache'

// Returning a Response from a request middleware short-circuits the chain and
// sends that Response without running the route handler (same mechanism the
// built-in CSRF middleware uses). Calling `next()` proceeds normally.
let kvCacheWired = false

/**
 * Wire the version + table-existence KV L2 caches (issue #2183) the first
 * time a request middleware actually runs. This MUST stay inside a
 * `.server()` callback body, not module top-level scope: TanStack Start
 * splits everything outside `.server()` callbacks into an isomorphic chunk
 * that does not carry the `cloudflare:workers` virtual module, so reading
 * `env` at top level here breaks the build (top-level `env` reads elsewhere
 * in this file are fine ONLY because the pre-existing ones already lived
 * inside `.server()` bodies).
 */
function wireVersionCacheKvOnce(): void {
  if (kvCacheWired) return
  kvCacheWired = true

  const binding = (env as Record<string, unknown> | undefined)?.[
    CHM_VERSION_CACHE_KV_BINDING
  ]
  const kv =
    binding && typeof binding === 'object' ? (binding as KVNamespace) : null

  setVersionCacheL2Provider(() => getVersionCache(kv))
  setTableExistenceL2Provider(() => getTableExistenceCache(kv))
}

const apiAuthMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    wireVersionCacheKvOnce()

    // Bridge the Worker env secret onto process.env so apiKeyAuthEnabled() /
    // verifyApiKey() (which read process.env.CHM_API_KEY_SECRET) can see it.
    bridgeApiKeyEnv(env as Record<string, string | undefined>)
    bridgePublicReadEnv(env as Record<string, string | undefined>)

    const guardResponse = await resolveApiGuard(request)
    if (guardResponse) {
      return guardResponse
    }

    return next()
  }
)

// ---------------------------------------------------------------------------
// Security response headers
// ---------------------------------------------------------------------------
// Applied to every response (pages, API, static assets). The middleware runs
// AFTER the downstream chain (via `next()`) so it can patch the final
// Response. See `@/lib/security-headers` for the header set and rationale.
// CSP is intentionally omitted — the app loads remote scripts (Clerk,
// analytics) and constructing a strict CSP would require ongoing maintenance
// that outweighs the benefit at this stage.

/**
 * Appends security headers to every response.
 *
 * `next()` returns the accumulated middleware context whose `.response` is
 * the final `Response` produced by the route handler or prerender. We clone
 * it with the extra headers. The middleware MUST come first in the array so
 * it wraps the entire chain (outermost position).
 */
export async function securityHeadersHandler({
  next,
  request,
}: {
  next: any
  request: any
}) {
  const result = await next()

  if (result.response instanceof Response) {
    result.response = withSecurityHeaders(result.response)

    const url = new URL(request.url)
    if (url.pathname === '/' || url.pathname === '/overview') {
      result.response.headers.set(
        'Link',
        '</.well-known/api-catalog>; rel="api-catalog", </.well-known/mcp/server-card.json>; rel="mcp-server-card"'
      )
    }
  }

  // Return the result (not void) — TanStack Start types a request middleware
  // as returning `RequestServerResult | Response`, and the runtime reads the
  // response from the returned value. Returning the mutated result both
  // type-checks and avoids relying on by-reference ctx mutation.
  return result
}

export const securityHeadersMiddleware = createMiddleware().server(
  securityHeadersHandler
)

async function sha256(text: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `sha256:${hashHex}`
}

export async function agentDiscoveryHandler({
  next,
  request,
}: {
  next: any
  request: any
}) {
  const url = new URL(request.url)
  const pathname = url.pathname

  // 1. HTML response as markdown content negotiation
  const accept = request.headers.get('accept') || ''
  const isPage =
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/.well-known/') &&
    !pathname.includes('.')
  if (isPage && accept.includes('text/markdown')) {
    const markdown = `# chmonitor

ClickHouse monitoring dashboard. Connect to ClickHouse instances and get real-time insights into clusters through system tables — metrics, query performance, table information, and cluster health.

## Core Features

- **Overview**: System metrics, processes, query statistics.
- **Explorer**: Inspect tables, databases, parts, projections, and schemas.
- **SQL Console**: Run queries against connected ClickHouse hosts.
- **AI Assistant**: Automated diagnostics, query optimization, and recommendations.

## API Documentation

API endpoints are accessible under \`/api/v1/\`. Discover them programmatically via the API Catalog at \`/.well-known/api-catalog\`.

## Agent Resources

- **API Catalog**: [/.well-known/api-catalog](/.well-known/api-catalog)
- **MCP Server**: [/.well-known/mcp/server-card.json](/.well-known/mcp/server-card.json)
- **Agent Skills**: [/.well-known/agent-skills/index.json](/.well-known/agent-skills/index.json)
- **Auth Instructions**: [/auth.md](/auth.md)
`
    const tokens = Math.ceil(markdown.length / 4)
    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'x-markdown-tokens': String(tokens),
      },
    })
  }

  // 2. auth.md
  if (pathname === '/auth.md') {
    const markdown = `# auth.md

Instructions for agent registration and authentication on chmonitor.

## Authentication Overview

chmonitor supports two main deployment configurations:
1. **Self-hosted / OSS (Default)**: Authentication is disabled (auth provider is "none"). Agents can access all API endpoints without credentials.
2. **Cloud (SaaS)**: Authentication is powered by Clerk. Agents can authenticate using JWT tokens or API keys if configured.

## Agent Registration

If API-key authentication is enabled, you can obtain a token or register your agent.
For secure machine-to-machine access, configure the \`CHM_API_KEY_SECRET\` environment variable.
`
    return new Response(markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
      },
    })
  }

  // 3. /.well-known/api-catalog
  if (pathname === '/.well-known/api-catalog') {
    const origin = url.origin
    const catalog = {
      linkset: [
        {
          anchor: `${origin}/api/v1`,
          profile: 'https://www.rfc-editor.org/info/rfc9727',
          'service-desc': [
            {
              href: `${origin}/api/v1/openapi.json`,
              type: 'application/openapi+json;version=3.0',
            },
          ],
          'service-doc': [
            {
              href: 'https://docs.chmonitor.dev/reference/api',
              type: 'text/html',
            },
          ],
          status: [
            {
              href: `${origin}/api/health`,
              type: 'application/json',
            },
          ],
        },
      ],
    }
    return Response.json(catalog, {
      status: 200,
      headers: {
        'Content-Type':
          'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      },
    })
  }

  // 4. /api/v1/openapi.json
  if (pathname === '/api/v1/openapi.json') {
    const openapi = {
      openapi: '3.0.0',
      info: {
        title: 'chmonitor API',
        version: '1.0.0',
        description: 'API endpoints for ClickHouse monitoring dashboard.',
      },
      paths: {
        '/api/health': {
          get: {
            summary: 'Health Check',
            responses: {
              '200': {
                description: 'Success',
              },
            },
          },
        },
      },
    }
    return Response.json(openapi, {
      status: 200,
      headers: {
        'Content-Type': 'application/openapi+json',
      },
    })
  }

  // 5. /.well-known/oauth-protected-resource
  if (pathname === '/.well-known/oauth-protected-resource') {
    const origin = url.origin
    const data = {
      resource: `${origin}/api/v1`,
      authorization_servers: [`${origin}/api/auth`],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header'],
    }
    return Response.json(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  // 6. /.well-known/oauth-authorization-server
  if (pathname === '/.well-known/oauth-authorization-server') {
    const origin = url.origin
    const data = {
      issuer: `${origin}/api/auth`,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/v1/auth/token`,
      jwks_uri: `${origin}/.well-known/jwks.json`,
      grant_types_supported: ['authorization_code', 'client_credentials'],
      response_types_supported: ['code'],
      agent_auth: {
        skill: 'agent-auth',
        register_uri: `${origin}/api/v1/agent/register`,
        identity_types_supported: ['anonymous', 'identity_assertion'],
        identity_assertion: {
          assertion_types_supported: ['verified_email'],
        },
        anonymous: {
          credential_types_supported: ['api_key'],
        },
        claim_uri: `${origin}/api/v1/agent/claim`,
      },
    }
    return Response.json(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  // 7. /.well-known/openid-configuration
  if (pathname === '/.well-known/openid-configuration') {
    const origin = url.origin
    const data = {
      issuer: `${origin}/api/auth`,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/v1/auth/token`,
      jwks_uri: `${origin}/.well-known/jwks.json`,
      response_types_supported: ['code', 'id_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
    }
    return Response.json(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  // 8. /.well-known/mcp/server-card.json
  if (pathname === '/.well-known/mcp/server-card.json') {
    const data = {
      serverInfo: {
        name: 'chmonitor-mcp-server',
        version: '1.0.0',
      },
      endpoint: '/api/mcp',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
    return Response.json(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  // 9. /.well-known/agent-skills/index.json
  if (pathname === '/.well-known/agent-skills/index.json') {
    const skillsList = []
    for (const skill of SKILLS) {
      const fileContent = `---
name: ${skill.name}
description: ${skill.description}
---
${skill.content}`
      const digest = await sha256(fileContent)
      skillsList.push({
        name: skill.name,
        type: 'skill-md',
        description: skill.description,
        url: `${url.origin}/.well-known/agent-skills/${skill.name}/SKILL.md`,
        digest,
      })
    }
    const data = {
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: skillsList,
    }
    return Response.json(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  // 10. /.well-known/agent-skills/:name/SKILL.md
  const skillMatch = pathname.match(
    /^\/\.well-known\/agent-skills\/([^/]+)\/SKILL\.md$/
  )
  if (skillMatch) {
    const skillName = skillMatch[1]
    const skill = SKILLS.find((s) => s.name === skillName)
    if (skill) {
      const fileContent = `---
name: ${skill.name}
description: ${skill.description}
---
${skill.content}`
      return new Response(fileContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
        },
      })
    }
    return new Response('Not Found', { status: 404 })
  }

  return next()
}

export const agentDiscoveryMiddleware = createMiddleware().server(
  agentDiscoveryHandler
)

// ---------------------------------------------------------------------------
// Clerk middleware
// ---------------------------------------------------------------------------
// `auth()` from `@clerk/tanstack-react-start/server` reads the authenticated
// session from `getGlobalStartContext().auth`, which is ONLY populated by
// `clerkMiddleware()`. Without it, every server-side `auth()` call throws
// `clerkMiddlewareNotConfigured` (silently caught by try/catch in
// feature-permission checks), causing all authenticated endpoints to return
// 401 even when the user has a valid Clerk session cookie.
//
// The middleware must run before apiAuthMiddleware so the auth context is
// available to downstream guards and route handlers.
//
// GUARD: `clerkMiddleware()` calls `clerkClient()` which requires
// `CLERK_SECRET_KEY`. This key is only available at runtime (Cloudflare Worker
// secret), NOT during CI builds or prerender. Without the guard, the build
// fails with "Clerk: no secret key provided" during static generation.

/** True when the Clerk secret key is available (runtime only, not CI build). */
function hasClerkSecretKey(): boolean {
  return Boolean(
    process.env.CLERK_SECRET_KEY || import.meta.env.CLERK_SECRET_KEY
  )
}

// ---------------------------------------------------------------------------
// Sentry server middleware (Cloudflare Worker)
// ---------------------------------------------------------------------------
// Workers have no long-lived process, so @sentry/cloudflare binds a client PER
// REQUEST via wrapRequestHandler: it opens a Sentry scope, runs the downstream
// chain, captures any thrown error, then RE-THROWS it so existing error
// handling is unchanged. No-op (passes straight through) when CHM_SENTRY_DSN is
// unset — the OSS default. Registered as the OUTERMOST middleware so it sees
// errors from every other middleware and route handler.
//
// `context: undefined` — TanStack middleware does not expose the Worker
// ExecutionContext, so the SDK flushes events inline before returning instead
// of via waitUntil. Acceptable for low event volume.
const sentryMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const options = resolveServerSentryOptions(
      env as Record<string, string | undefined>
    )
    if (!options) return next()

    let result: Awaited<ReturnType<typeof next>> | undefined
    // For responses it classifies as "streaming" (e.g. text/plain without a
    // Content-Length, like /healthz), wrapRequestHandler pipes res.body
    // through its own TransformStream and returns a NEW Response wrapping
    // that piped stream — which locks the original response's body. We MUST
    // use that returned Response (not the original `result.response`): the
    // original's body is now a locked/orphaned stream, so re-serializing it
    // throws "Body has already been used" at the Cloudflare edge.
    const wrappedResponse = await wrapRequestHandler(
      { options, request, context: undefined },
      async () => {
        result = await next()
        // wrapRequestHandler needs a Response to thread through; the middleware
        // result carries it. A throw above propagates out (captured + re-thrown).
        return result.response instanceof Response
          ? result.response
          : new Response(null)
      }
    )
    // `result` is always assigned when wrapRequestHandler resolves without throwing.
    if (result && wrappedResponse instanceof Response) {
      result.response = wrappedResponse
    }
    return result as Awaited<ReturnType<typeof next>>
  }
)

// ---------------------------------------------------------------------------
// OTel trace export (opt-in, OFF by default)
// ---------------------------------------------------------------------------
// Root `dashboard-request` span for every request, per
// plans/39-otel-trace-export.md. True no-op when CHM_OTEL_EXPORTER_URL is
// unset/invalid: getOtelTracer() returns undefined and withSpan() runs next()
// directly without creating a span. See src/lib/otel/exporter.ts.
//
// getOtelTracer(env) is called here (with the Worker env binding) to warm the
// memoized singleton for the whole request; nested spans created deeper in
// the call chain (e.g. the query executor, which has no `env` handy) reuse
// the cached result via their own no-arg getOtelTracer() call.
//
// Like sentryMiddleware above, TanStack Start's request middleware does not
// expose the Worker ExecutionContext, so there is no `waitUntil` to defer the
// batch export past the response — forceFlushOtel() is awaited inline before
// returning. Only reachable when export is enabled, so the added latency is
// opt-in.
const otelMiddleware = createMiddleware().server(async ({ next }) => {
  getOtelTracer(env as Record<string, string | undefined>)
  try {
    // Wrapped in an `async` arrow (not `() => next()`) so its declared return
    // type is a real Promise<T> — next()'s own result type isn't structurally
    // a Promise, which withSpan's `fn` parameter requires.
    return await withSpan('dashboard-request', {}, async () => next())
  } finally {
    await forceFlushOtel()
  }
})

// ---------------------------------------------------------------------------
// PostHog server-side crash capture
// ---------------------------------------------------------------------------
// Records server/API exceptions to PostHog as `$exception` events, mirroring
// the client-side crash capture. A no-op unless CHM_ANALYTICS_KEY is set in the
// Worker env (see lib/analytics/analytics.server.ts). Registered just inside the
// Sentry middleware so it wraps the whole downstream chain (otel, auth, route
// handlers). It re-throws so existing error handling — including Sentry — is
// unchanged. The capture is awaited inline (no ExecutionContext is exposed for
// waitUntil, same as sentryMiddleware); only reached on the rare error path.
const analyticsServerMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    try {
      return await next()
    } catch (error) {
      await captureServerException(
        env as Record<string, string | undefined>,
        error,
        { path: new URL(request.url).pathname }
      )
      throw error
    }
  }
)

export const startInstance = createStart(() => {
  // Order matters: Sentry is first (outermost) so it captures errors from every
  // other middleware; otel is next so its root span covers the rest of the
  // chain (security-headers, auth, the route handler); security-headers wraps
  // what's left and patches the response on the way out.
  const middleware = [
    sentryMiddleware,
    analyticsServerMiddleware,
    otelMiddleware,
    agentDiscoveryMiddleware,
    securityHeadersMiddleware,
  ]

  if (isClerkAuthProvider() && hasClerkSecretKey()) {
    middleware.push(clerkMiddleware())
  }

  middleware.push(apiAuthMiddleware)

  return { requestMiddleware: middleware }
})
