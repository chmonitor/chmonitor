/**
 * Request-level auth guard for `/api/v1/*` routes.
 *
 * Ported from apps/dashboard/middleware.ts (#1397). The Next app ran this in
 * Next middleware; TanStack Start has no `middleware.ts`, so the equivalent
 * runs as a global request middleware registered in `src/start.ts`.
 *
 * Pluggable auth model. The active provider comes from `getAuthProvider()`
 * (`CHM_AUTH_PROVIDER` / `VITE_AUTH_PROVIDER`):
 *
 *  - `none`  — public dashboard; every caller is authenticated.
 *  - `clerk` — browser Clerk session (the `__session` cookie / Clerk token).
 *  - `proxy` — a trusted reverse proxy (Cloudflare Access JWT, or a trusted
 *              identity header gated by a shared secret).
 *
 * On top of the provider, API-key auth (`chm_` Bearer tokens) is ALWAYS on
 * whenever `CHM_API_KEY_SECRET` is set, for programmatic/MCP clients.
 *
 * Enforcement on `/api/v1/*` (`getApiKeyAuthFailure`):
 *  - PUBLIC passthrough only when provider is `none` AND API-key auth is off.
 *  - Otherwise a request must present EITHER a valid `chm_` Bearer token OR pass
 *    the active provider's `authenticateRequest`. Anonymous requests get a 401
 *    JSON `{ error: 'Authentication required' }`. Exempt: `/api/v1/auth/api-key`
 *    (it owns its own secret-based auth in the handler).
 *
 * Also reproduced from the Next middleware: the cloud→dash 301 redirect
 * (`getLegacyHostRedirect`).
 *
 * `apiKeyAuthEnabled()` and `verifyApiKey()` read `process.env.CHM_API_KEY_SECRET`
 * directly. On Cloudflare Workers the canonical source is the `env` binding, so
 * `bridgeApiKeyEnv(env)` copies the secret onto `process.env` before the check
 * (same bridge pattern as `bridgeClickHouseEnv`).
 */

import {
  apiKeyAuthEnabled,
  getBearerToken,
  verifyApiKey,
} from '@chm/mcp-server/auth'
import { getAuthProvider, isAuthProviderConfigError } from '@/lib/auth/provider'
import { resolveServerAuthProvider } from '@/lib/auth/providers'

const API_V1_PREFIX = '/api/v1/'
// Key issuance route has its own secret-based auth in its handler.
const API_KEY_ISSUANCE_PATH = '/api/v1/auth/api-key'

const LEGACY_HOST = 'cloud.chmonitor.dev'
const CANONICAL_HOST = 'dash.chmonitor.dev'

type EnvBindings = Record<string, string | undefined>

/**
 * Copy CHM_API_KEY_SECRET from the Worker `env` binding onto `process.env`
 * so `apiKeyAuthEnabled()` / `verifyApiKey()` (which read process.env) see it.
 * Idempotent; only sets when present on the binding and not already set.
 */
export function bridgeApiKeyEnv(bindings: EnvBindings): void {
  if (typeof process === 'undefined' || !process.env) return
  const value = bindings.CHM_API_KEY_SECRET
  if (value != null && value !== '' && process.env.CHM_API_KEY_SECRET == null) {
    process.env.CHM_API_KEY_SECRET = value
  }
}

/**
 * Copy CHM_CLERK_PUBLIC_READ from the Worker `env` binding onto `process.env`
 * so `publicReadEnabled()` (which reads process.env) sees it on workerd.
 * Idempotent; only sets when present on the binding and not already set.
 */
export function bridgePublicReadEnv(bindings: EnvBindings): void {
  if (typeof process === 'undefined' || !process.env) return
  const value = bindings.CHM_CLERK_PUBLIC_READ
  if (
    value != null &&
    value !== '' &&
    process.env.CHM_CLERK_PUBLIC_READ == null
  ) {
    process.env.CHM_CLERK_PUBLIC_READ = value
  }
}

/**
 * Opt-in public read-only mode for the Clerk provider.
 *
 * When `CHM_CLERK_PUBLIC_READ` is truthy, anonymous `/api/v1/*` requests are
 * NOT blanket-401'd; the per-route `authorizeFeatureRequest()` becomes the sole
 * gate. Public features serve data to anonymous visitors, while `authenticated`
 * features (agent, actions) still 401. Named with the CLERK prefix because it
 * only relaxes the clerk posture — `none` is already fully open and `proxy`
 * fronts its own auth.
 */
export function publicReadEnabled(): boolean {
  const raw = process.env.CHM_CLERK_PUBLIC_READ?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

/**
 * cloud.chmonitor.dev is a legacy alias of the dashboard. Permanently redirect
 * it to the canonical dash.chmonitor.dev host, preserving path and query.
 *
 * Mirrors `getLegacyHostRedirect` from the Next middleware.
 */
export function getLegacyHostRedirect(request: Request): Response | null {
  const host = request.headers.get('host')
  if (host !== LEGACY_HOST) {
    return null
  }

  const url = new URL(request.url)
  return Response.redirect(
    `https://${CANONICAL_HOST}${url.pathname}${url.search}`,
    301
  )
}

/**
 * Enforce API-key auth for `/api/v1/*` routes when it is enabled.
 *
 * Returns a 401 Response to short-circuit, or `null` to allow the request.
 * Mirrors `getApiKeyAuthFailure` from the Next middleware.
 */
export async function getApiKeyAuthFailure(
  request: Request
): Promise<Response | null> {
  const { pathname } = new URL(request.url)

  if (!pathname.startsWith(API_V1_PREFIX)) {
    return null
  }

  // Public passthrough only when the dashboard is fully open: provider is
  // `none` AND API-key auth is off. Any other config enforces.
  if (getAuthProvider() === 'none' && !apiKeyAuthEnabled()) return null

  // Key issuance route has its own secret-based auth in the handler.
  if (pathname === API_KEY_ISSUANCE_PATH) {
    return null
  }

  // 1. Programmatic clients (MCP, scripts): a valid `chm_` Bearer token.
  const headerToken = getBearerToken(request.headers.get('authorization'))
  if (headerToken) {
    const result = await verifyApiKey(headerToken)
    if (result.valid) return null
    // Not a valid chm_ key — fall through to the provider check; the
    // Authorization header may carry a Clerk/proxy token rather than a chm_ key.
  }

  // 2. Opt-in public read-only mode (clerk only): let ALL /api/v1/* requests
  //    through without ever invoking the Clerk provider, and defer to each
  //    route's authorizeFeatureRequest() for fine-grained enforcement. Public
  //    features serve data to anonymous visitors; agent/actions and any write
  //    are `authenticated`/non-`read` and still 401 at the route (writes never
  //    qualify for the anonymous baseline there — see
  //    lib/feature-permissions/server.ts).
  //
  //    Checked BEFORE the provider call below: whether or not the caller is
  //    actually signed in, this guard's outcome is the same (`null` = pass) in
  //    this config, so verifying the Clerk session here first is pure wasted
  //    work — a full JWT verify (+ cold-start JWKS fetch) on every anonymous
  //    read on the highest-volume path (#2186).
  const provider = getAuthProvider()
  if (provider === 'clerk' && publicReadEnabled()) return null

  // 3. The active auth provider (clerk session, proxy identity, …). Browser
  //    clients send a Clerk `__session` cookie; proxy deployments send a
  //    Cloudflare Access JWT or a trusted identity header.
  //
  //    Skip this for the `none` provider: reaching here with `none` means
  //    API-key auth is ON (the public passthrough above already returned for
  //    `none` + no key), so the API key is the ONLY accepted credential. The
  //    `none` provider authenticates everyone, so consulting it here would let
  //    keyless requests through and silently defeat API-key auth.
  if (
    provider !== 'none' &&
    (await resolveServerAuthProvider(provider).authenticateRequest(request))
      .authenticated
  ) {
    return null
  }

  return jsonError('Authentication required', 401)
}

/**
 * Enforce auth for a single request, regardless of path prefix.
 *
 * Same logic as `getApiKeyAuthFailure` minus the `/api/v1/` prefix gate and
 * minus the key-issuance exemption. Use this to protect non-`/api/v1/` state-
 * changing endpoints (e.g. `/api/clean`, `/api/init`, `/api/pageview`).
 *
 * Returns a 401/403 Response on failure, or `null` to allow the request.
 * When provider is `none` AND API-key auth is off, always returns `null`
 * (anonymous is allowed — public dashboard).
 *
 * `bridgeApiKeyEnv` must have been called by the caller (start.ts) before
 * invoking this, so the env binding is visible to process.env-based helpers on
 * Workers.
 */
export async function enforceAuth(request: Request): Promise<Response | null> {
  // Public passthrough when the dashboard is fully open.
  if (getAuthProvider() === 'none' && !apiKeyAuthEnabled()) return null

  // 1. Programmatic clients: a valid `chm_` Bearer token.
  const headerToken = getBearerToken(request.headers.get('authorization'))
  if (headerToken) {
    const result = await verifyApiKey(headerToken)
    if (result.valid) return null
  }

  // 2. Opt-in public read-only mode (clerk only) — checked BEFORE the provider
  //    call below so an anonymous-read config never pays for a Clerk verify
  //    it doesn't need (#2186); see the matching comment in
  //    `getApiKeyAuthFailure`.
  const provider = getAuthProvider()
  if (provider === 'clerk' && publicReadEnabled()) return null

  // 3. The active auth provider (clerk session, proxy identity, …).
  if (
    provider !== 'none' &&
    (await resolveServerAuthProvider(provider).authenticateRequest(request))
      .authenticated
  ) {
    return null
  }

  return jsonError('Authentication required', 401)
}

/**
 * Whether a request is genuinely authenticated — a valid `chm_` API key OR an
 * authenticated provider session (clerk/proxy). Use this to gate exposure of
 * sensitive deployment/security metadata (e.g. `/api/health`), NOT data access.
 *
 * Deliberately stricter than {@link enforceAuth}: it does NOT honor
 * `publicReadEnabled()`. Public read-only mode grants anonymous visitors access
 * to dashboard *data*, but must never expose deployment posture (git SHA, auth
 * provider, key prefixes) — that is a separate trust boundary (#1768).
 *
 * Returns `true` for a fully-open deployment (`none` provider, no API key),
 * since such deployments have no security boundary to protect.
 *
 * `bridgeApiKeyEnv` must have been called before this so the env binding is
 * visible to process.env-based helpers on Workers.
 */
export async function isAuthenticatedRequest(
  request: Request
): Promise<boolean> {
  // Fully-open deployment (no provider, no API key): nothing to protect.
  if (getAuthProvider() === 'none' && !apiKeyAuthEnabled()) return true

  // 1. Programmatic clients: a valid `chm_` Bearer token.
  const headerToken = getBearerToken(request.headers.get('authorization'))
  if (headerToken) {
    const result = await verifyApiKey(headerToken)
    if (result.valid) return true
  }

  // 2. An authenticated provider session (clerk cookie, proxy identity, …).
  const provider = getAuthProvider()
  if (
    provider !== 'none' &&
    (await resolveServerAuthProvider(provider).authenticateRequest(request))
      .authenticated
  ) {
    return true
  }

  // Intentionally NO publicReadEnabled() relaxation here — see doc comment.
  return false
}

/**
 * Resolve the auth-guard response for a request, or `null` to proceed.
 *
 * Order mirrors the Next middleware:
 *  1. legacy host 301 redirect (any path)
 *  2. only `/api/v1/*` requests run the auth checks (others pass through)
 *  3. invalid auth-provider config → 500
 *  4. API-key auth failure → 401
 *
 * `bridgeApiKeyEnv` must be called by the caller (start.ts) before this, so
 * the env binding is visible to process.env-based helpers on Workers.
 */
export async function resolveApiGuard(
  request: Request
): Promise<Response | null> {
  const legacyHostRedirect = getLegacyHostRedirect(request)
  if (legacyHostRedirect) {
    return legacyHostRedirect
  }

  const { pathname } = new URL(request.url)
  if (!pathname.startsWith(API_V1_PREFIX)) {
    return null
  }

  // Surface invalid auth-provider configuration the same way Next did (500),
  // rather than letting a misconfig silently fall through.
  try {
    getAuthProvider()
  } catch (error) {
    if (isAuthProviderConfigError(error)) {
      return jsonError('Invalid auth provider configuration', 500)
    }
    throw error
  }

  return getApiKeyAuthFailure(request)
}
