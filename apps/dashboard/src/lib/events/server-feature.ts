/**
 * Server-side detection of webhook-subscription storage availability.
 * Mirrors `lib/connection-store/server-feature.ts` — same Clerk + D1
 * requirement, own feature flag (an operator may want per-user connections
 * without the webhook bus, or vice versa). Fails closed: self-hosted (no
 * Clerk / no D1) sees this feature simply absent — no behavior change.
 */

import { getPlatformBindings } from '@chm/platform'
import { parseDeploymentMode } from '@/lib/config/deployment-mode'

const D1_BINDING_NAME = 'CHM_CLOUD_D1'

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) {
    return process.env[key]
  }
  return undefined
}

function isFeatureFlagEnabled(): boolean {
  const value =
    readEnv('CHM_FEATURE_WEBHOOK_SUBSCRIPTIONS') ??
    readEnv('VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS')
  // Explicit flag wins; otherwise default from the deployment profile so
  // `CHM_DEPLOYMENT_MODE=cloud` enables it without an extra flag (same
  // default as user-connections).
  if (value !== undefined && value !== '')
    return value === 'true' || value === '1'
  return parseDeploymentMode(readEnv('CHM_DEPLOYMENT_MODE')) === 'cloud'
}

function isClerkAuth(): boolean {
  const provider =
    readEnv('CHM_AUTH_PROVIDER') ?? readEnv('VITE_AUTH_PROVIDER') ?? 'none'
  return provider === 'clerk' && Boolean(readEnv('CLERK_SECRET_KEY'))
}

// Unlike `connection-store` (D1 + Postgres via `resolve-store.ts`),
// `subscription-store.ts` is D1-only (plan 44: "NO new backend beyond the
// existing D1 store pattern") — so availability is strictly "is the D1
// binding present", with no Postgres/DATABASE_URL fallback that would enable
// this flag while the store itself has nothing to write to.
function hasDatabaseBackend(): boolean {
  try {
    return Boolean(getPlatformBindings().getD1Database(D1_BINDING_NAME))
  } catch {
    return false
  }
}

export interface WebhookSubscriptionsServerConfig {
  enabled: boolean
}

export function getWebhookSubscriptionsServerConfig(): WebhookSubscriptionsServerConfig {
  return {
    enabled: isFeatureFlagEnabled() && isClerkAuth() && hasDatabaseBackend(),
  }
}
