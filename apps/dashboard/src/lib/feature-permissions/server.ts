/**
 * Server-side feature-permission helpers for TanStack Start / Cloudflare Workers.
 *
 * Ported from apps/dashboard/lib/feature-permissions/server.ts with these
 * intentional differences:
 *
 * - No CHM_CONFIG_FILE loading: `node:fs/promises` is not available in workerd.
 *   All config comes from env vars only.
 * - Clerk `auth()` is imported dynamically and guarded by isClerkAuthProvider()
 *   so the symbol is never touched when Clerk is disabled. Uses
 *   `@clerk/tanstack-react-start/server` (not `@clerk/nextjs/server`).
 * - `auth()` takes no arguments in @clerk/tanstack-react-start@1.3.2
 *   (GetAuthFnNoRequest). The `request` parameter is accepted for API
 *   compatibility with callers but is not forwarded.
 * - Worker env bindings take precedence over process.env via `readEnv()`.
 */

import type { FeaturePermission } from './types'

import {
  anonymousCapabilities,
  mergeFeatureOverrides,
  normalizeFeatureAccess,
  normalizeFeatureId,
  resolveFeatureState,
} from './shared'
import {
  FEATURE_IDS,
  type FeatureAccess,
  type FeatureOverride,
  type FeatureOverrides,
} from './types'
import { env } from 'cloudflare:workers'
import { isValidAgentApiBearerToken } from '@/lib/auth/agent-api-token'
import { parseAuthProvider } from '@/lib/auth/provider'
import { parseDeploymentMode } from '@/lib/config/deployment-mode'

// ---------------------------------------------------------------------------
// Env access: Cloudflare binding first, then process.env.
// ---------------------------------------------------------------------------

type EnvBindings = Record<string, string | undefined>

function readEnv(key: string): string | undefined {
  try {
    const bindings = env as EnvBindings
    const fromBinding = bindings[key]
    if (fromBinding !== undefined && fromBinding !== '') return fromBinding
  } catch {
    // cloudflare:workers env not available (e.g. Node dev server)
  }
  if (typeof process !== 'undefined' && process.env) {
    const fromProcess = process.env[key]
    if (fromProcess !== undefined && fromProcess !== '') return fromProcess
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Config resolution (env-only; no file loading).
// ---------------------------------------------------------------------------

function parseBoolean(
  value: string | undefined,
  name: string
): boolean | undefined {
  if (value === undefined || value === '') return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  console.warn(`[feature-permissions] Invalid boolean for ${name}: "${value}"`)
  return undefined
}

function splitFeatureList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseEnvFeatureOverrides(): FeatureOverrides {
  let overrides: FeatureOverrides = {}

  for (const feature of splitFeatureList(readEnv('CHM_DISABLED_FEATURES'))) {
    overrides = mergeFeatureOverrides(overrides, {
      [normalizeFeatureId(feature)]: { enabled: false },
    })
  }

  for (const feature of splitFeatureList(
    readEnv('CHM_AUTH_REQUIRED_FEATURES')
  )) {
    overrides = mergeFeatureOverrides(overrides, {
      [normalizeFeatureId(feature)]: {
        access: 'authenticated' as FeatureAccess,
      },
    })
  }

  for (const feature of FEATURE_IDS) {
    const envKey = `CHM_FEATURE_${feature.toUpperCase()}`
    const enabled = parseBoolean(
      readEnv(`${envKey}_ENABLED`),
      `${envKey}_ENABLED`
    )
    const accessRaw = readEnv(`${envKey}_ACCESS`)
    const override: FeatureOverride = {}
    if (enabled !== undefined) override.enabled = enabled
    if (accessRaw) {
      try {
        override.access = normalizeFeatureAccess(accessRaw)
      } catch {
        // ignore invalid values
      }
    }
    if (Object.keys(override).length > 0) {
      overrides = mergeFeatureOverrides(overrides, { [feature]: override })
    }
  }

  return overrides
}

interface AppConfig {
  authProvider: ReturnType<typeof parseAuthProvider>
  features: FeatureOverrides
}

let _cachedAppConfig: AppConfig | null = null

/**
 * Resolve the app's feature-permission config from env.
 *
 * Cached after the first call: `getAppConfig()` takes no per-request inputs
 * (auth provider + feature overrides come only from env vars, which are
 * immutable at runtime on Workers), and it is called on every gated request
 * via `authorizeFeatureRequest`. Re-parsing ~40 env lookups per request is
 * wasted work. Mirrors the `_cachedEnv` pattern in
 * `packages/clickhouse-client/src/clickhouse/env-schema.ts`.
 */
export function getAppConfig(): AppConfig {
  if (_cachedAppConfig) return _cachedAppConfig

  const authProvider = parseAuthProvider(
    readEnv('CHM_AUTH_PROVIDER') ??
      import.meta.env.VITE_AUTH_PROVIDER ??
      readEnv('NEXT_PUBLIC_AUTH_PROVIDER')
  )
  _cachedAppConfig = { authProvider, features: parseEnvFeatureOverrides() }
  return _cachedAppConfig
}

/**
 * Reset the cached AppConfig — for use in tests only.
 */
export function _resetAppConfigCache(): void {
  _cachedAppConfig = null
}

/**
 * Anonymous read under clerk. Explicit `CHM_CLERK_PUBLIC_READ` wins; otherwise
 * it defaults from the deployment profile — `CHM_DEPLOYMENT_MODE=cloud` turns it ON so
 * the cloud instance serves its public read-only demo without an extra flag.
 * See api-guard.ts.
 */
export function publicReadEnabled(): boolean {
  const explicit = parseBoolean(
    readEnv('CHM_CLERK_PUBLIC_READ'),
    'CHM_CLERK_PUBLIC_READ'
  )
  if (explicit !== undefined) return explicit
  return parseDeploymentMode(readEnv('CHM_DEPLOYMENT_MODE')) === 'cloud'
}

// ---------------------------------------------------------------------------
// Auth check.
// ---------------------------------------------------------------------------

async function isAuthenticatedRequest(
  request: Request,
  config: AppConfig,
  options: { allowAgentBearerToken?: boolean } = {}
): Promise<boolean> {
  // Auth disabled (`none`): there is no sign-in, so every request is authorized.
  // This makes `authenticated`-access features fully open in `none` mode (the
  // matrix's "everything open" end state). The backend remains the single
  // security boundary; it simply has nothing to enforce when auth is off.
  if (config.authProvider === 'none') return true

  if (
    options.allowAgentBearerToken &&
    (await isValidAgentApiBearerToken(request))
  ) {
    return true
  }

  // Reverse-proxy providers authenticate by re-running their own header/JWT
  // check against this request. Without this, `authenticated`-access features
  // (agent, writes) would 401 even for a proxy-authenticated caller, because
  // the matrix would treat every proxy request as anonymous. Dynamic import
  // keeps the provider graph (and Clerk's SDK via the index) out of this
  // module's static bundle.
  if (config.authProvider === 'proxy' || config.authProvider === 'trusted') {
    const { resolveServerAuthProvider } = await import('@/lib/auth/providers')
    const result = await resolveServerAuthProvider(
      config.authProvider
    ).authenticateRequest(request)
    return result.authenticated
  }

  if (config.authProvider !== 'clerk') return false

  try {
    // auth() in @clerk/tanstack-react-start@1.3.2 is no-request (GetAuthFnNoRequest).
    const { auth } = await import('@clerk/tanstack-react-start/server')
    const authResult = await auth()
    return Boolean(authResult?.userId)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Public helpers.
// ---------------------------------------------------------------------------

function jsonFeatureError(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/**
 * Whether `request` is anonymous AND the deployment grants anonymous read
 * (`publicReadEnabled()`).
 *
 * Reuses the exact same auth resolution `authorizeFeatureRequest` uses (cheap
 * anonymous baseline, no Clerk call for the common anonymous case; Clerk/proxy
 * check otherwise) so this can never disagree with the per-feature gate about
 * who counts as "signed in". Intended for callers that need a strict
 * anonymous/authenticated split BEFORE any feature-specific decision — e.g.
 * the shared edge-cache gate (#2181), where writing an authenticated caller's
 * response into `caches.default` would leak it to every other visitor.
 */
export async function isAnonymousPublicReadRequest(
  request: Request
): Promise<boolean> {
  if (!publicReadEnabled()) return false
  const config = getAppConfig()
  return !(await isAuthenticatedRequest(request, config))
}

export async function authorizeFeatureRequest(
  permission: FeaturePermission | undefined,
  request: Request,
  options: { allowAgentBearerToken?: boolean } = {}
): Promise<Response | null> {
  if (!permission) return null

  const config = getAppConfig()

  const state = resolveFeatureState(permission, config)
  if (!state.enabled) {
    return jsonFeatureError(
      404,
      'FEATURE_DISABLED',
      `Feature "${permission.feature}" is disabled.`
    )
  }

  // Anonymous baseline first (cheap, no Clerk call): a public READ is allowed
  // when the deployment grants anonymous read. Writes never qualify here.
  const operation = permission.operation ?? 'read'
  const caps = anonymousCapabilities(config.authProvider, publicReadEnabled())
  if (operation === 'read' && state.access === 'public' && caps.read) {
    return null
  }

  // Otherwise require an authenticated caller (Clerk session / bearer token;
  // `none` authenticates everyone).
  if (await isAuthenticatedRequest(request, config, options)) return null

  return jsonFeatureError(
    401,
    'AUTHENTICATION_REQUIRED',
    `Feature "${permission.feature}" requires authentication.`,
    { 'www-authenticate': 'Bearer' }
  )
}
