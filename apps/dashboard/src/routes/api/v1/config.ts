/**
 * App config endpoint
 * GET /api/v1/config
 *
 * Returns the public feature-permission config the client consumes:
 *   { authProvider, principal, features, resolved }
 *
 * Ported from apps/dashboard/app/api/v1/config/route.ts +
 * apps/dashboard/lib/feature-permissions/server.ts:getPublicFeaturePermissionConfig.
 *
 * WORKERD CONSTRAINTS (intentional differences from the Next app):
 * - No CHM_CONFIG_FILE loading: the dashboard's loadConfigFile() uses
 *   `node:fs/promises` + js-yaml/smol-toml, which are not wired in this app.
 *   File-based overrides are therefore NOT read here — env-driven config only.
 * - Principal is ALWAYS 'anonymous': resolving an authenticated principal
 *   requires Clerk's server `auth()` from '@clerk/nextjs/server', which is not
 *   available in workerd and must not be imported (FAIL-LOUD rule). Per-request
 *   auth is centralized in middleware. The client treats principal as a hint;
 *   the server still enforces auth on protected routes.
 * - authProvider is read from the runtime CHM_AUTH_PROVIDER worker var, falling
 *   back to the build-time import.meta.env.VITE_AUTH_PROVIDER constant.
 *
 * The shared feature-resolution helpers (lib/feature-permissions/shared.ts) and
 * env-override parsing (server.ts) are not ported into this app, so the minimal
 * pieces are inlined below. Response SHAPE matches PublicFeaturePermissionConfig.
 */

import { createFileRoute } from '@tanstack/react-router'

import type {
  FeatureAccess,
  FeatureId,
  FeatureOverride,
  FeatureOverrides,
  FeatureState,
  PublicFeaturePermissionConfig,
} from '@/lib/feature-permissions/types'

import { env } from 'cloudflare:workers'
import { parseAuthProvider } from '@/lib/auth/provider'
import { getUserConnectionsServerConfig } from '@/lib/connection-store/server-feature'
import {
  FEATURE_ACCESS_VALUES,
  FEATURE_IDS,
} from '@/lib/feature-permissions/types'
import { getPlatformBindings } from '@/lib/platform-native'

// ---------------------------------------------------------------------------
// Inlined feature-permission resolution (mirror lib/feature-permissions/shared.ts).
// ---------------------------------------------------------------------------

const DEFAULT_FEATURE_ACCESS: FeatureAccess = 'public'

const FEATURE_ID_SET = new Set<string>(FEATURE_IDS)
const FEATURE_ACCESS_SET = new Set<string>(FEATURE_ACCESS_VALUES)
const FEATURE_ACCESS_ALIASES: Record<string, FeatureAccess> = {
  guest: 'public',
}

function isFeatureId(value: string): value is FeatureId {
  return FEATURE_ID_SET.has(value)
}

function isFeatureAccess(value: string): value is FeatureAccess {
  return FEATURE_ACCESS_SET.has(value)
}

function normalizeFeatureId(value: string): FeatureId {
  const normalized = value.trim().toLowerCase().replaceAll('-', '_')
  if (isFeatureId(normalized)) return normalized
  throw new Error(
    `Invalid feature "${value}". Expected one of: ${FEATURE_IDS.join(', ')}.`
  )
}

function normalizeFeatureAccess(value: string): FeatureAccess {
  const normalized = value.trim().toLowerCase()
  const alias = FEATURE_ACCESS_ALIASES[normalized]
  if (alias) return alias
  if (isFeatureAccess(normalized)) return normalized
  throw new Error(
    `Invalid feature access "${value}". Expected one of: ${FEATURE_ACCESS_VALUES.join(
      ', '
    )}, guest.`
  )
}

function resolveFeatureState(
  feature: FeatureId,
  features: FeatureOverrides
): FeatureState {
  const override = features[feature]
  return {
    enabled: override?.enabled ?? true,
    access: override?.access ?? DEFAULT_FEATURE_ACCESS,
  }
}

function getResolvedFeatureStates(
  features: FeatureOverrides
): Record<FeatureId, FeatureState> {
  const resolved: Record<string, FeatureState> = {}
  for (const featureId of FEATURE_IDS) {
    resolved[featureId] = resolveFeatureState(featureId, features)
  }
  return resolved as Record<FeatureId, FeatureState>
}

function mergeFeatureOverrides(
  base: FeatureOverrides,
  next: FeatureOverrides
): FeatureOverrides {
  const merged: FeatureOverrides = {}
  for (const [feature, override] of Object.entries(base)) {
    merged[normalizeFeatureId(feature)] = { ...override }
  }
  for (const [feature, override] of Object.entries(next)) {
    const id = normalizeFeatureId(feature)
    merged[id] = { ...(merged[id] ?? {}), ...override }
  }
  return merged
}

// ---------------------------------------------------------------------------
// Env access (Worker binding first, then process.env).
// ---------------------------------------------------------------------------

type EnvBindings = Record<string, string | undefined>

function readEnv(key: string): string | undefined {
  const bindings = env as EnvBindings
  const fromBinding = bindings[key]
  if (fromBinding !== undefined && fromBinding !== '') return fromBinding
  if (typeof process !== 'undefined' && process.env) {
    const fromProcess = process.env[key]
    if (fromProcess !== undefined && fromProcess !== '') return fromProcess
  }
  return undefined
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function splitFeatureList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * Build feature overrides from env vars (mirror server.ts parseEnvFeatureOverrides):
 *   CHM_DISABLED_FEATURES, CHM_AUTH_REQUIRED_FEATURES (comma lists),
 *   CHM_FEATURE_<ID>_ENABLED, CHM_FEATURE_<ID>_ACCESS (per feature).
 */
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
      [normalizeFeatureId(feature)]: { access: 'authenticated' },
    })
  }

  for (const feature of FEATURE_IDS) {
    const envKey = `CHM_FEATURE_${feature.toUpperCase()}`
    const enabled = parseBoolean(readEnv(`${envKey}_ENABLED`))
    const access = readEnv(`${envKey}_ACCESS`)

    const override: FeatureOverride = {}
    if (enabled !== undefined) override.enabled = enabled
    if (access !== undefined && access !== '') {
      override.access = normalizeFeatureAccess(access)
    }

    if (Object.keys(override).length > 0) {
      overrides = mergeFeatureOverrides(overrides, { [feature]: override })
    }
  }

  return overrides
}

function getPublicFeaturePermissionConfig(): PublicFeaturePermissionConfig {
  const authProvider = parseAuthProvider(
    readEnv('CHM_AUTH_PROVIDER') ??
      import.meta.env.VITE_AUTH_PROVIDER ??
      readEnv('NEXT_PUBLIC_AUTH_PROVIDER')
  )

  const features = parseEnvFeatureOverrides()
  const resolved = getResolvedFeatureStates(features)

  // What an anonymous caller may do under this posture (mirror shared.ts
  // anonymousCapabilities; inlined to keep this route self-contained). The
  // client combines this with its Clerk signed-in state to gate write UI.
  const publicRead = parseBoolean(readEnv('CHM_CLERK_PUBLIC_READ')) === true
  const capabilities =
    authProvider === 'none'
      ? { read: true, write: true }
      : authProvider === 'clerk' && publicRead
        ? { read: true, write: false }
        : { read: false, write: false }

  const userConnections = getUserConnectionsServerConfig()

  // Metadata DB = anywhere app state (report subscriptions, per-user
  // connections, shared dashboards) can persist: the D1 binding on Cloudflare,
  // or a Postgres URL on Docker/K8s. Fail-open false so an OSS deploy without
  // one just dims the dependent menu items instead of hiding them.
  let metadataDbAvailable = false
  try {
    metadataDbAvailable =
      getPlatformBindings().getD1Database('CHM_CLOUD_D1') !== null ||
      Boolean(readEnv('DATABASE_URL') ?? readEnv('POSTGRES_URL'))
  } catch {
    metadataDbAvailable = false
  }

  return {
    authProvider,
    // WORKERD: no server-side Clerk auth() here → always anonymous.
    // Protected routes are enforced by middleware regardless.
    principal: 'anonymous',
    features,
    resolved,
    capabilities,
    userConnections: {
      dbStorageEnabled: userConnections.dbStorageEnabled,
      requiresAuth: userConnections.requiresAuth,
    },
    metadataDb: { available: metadataDbAvailable },
  }
}

export const Route = createFileRoute('/api/v1/config')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const config = getPublicFeaturePermissionConfig()
          // Env-derived feature flags, principal always anonymous — cache at edge.
          return Response.json(config, {
            headers: {
              'Cache-Control':
                'public, s-maxage=300, stale-while-revalidate=300',
            },
          })
        } catch (err) {
          return Response.json(
            {
              error: {
                code: 'INVALID_FEATURE_PERMISSION_CONFIG',
                message:
                  err instanceof Error
                    ? err.message
                    : 'Invalid feature permission config',
              },
            },
            { status: 500 }
          )
        }
      },
    },
  },
})
