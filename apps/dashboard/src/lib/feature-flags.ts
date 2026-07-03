/**
 * Feature flag system for gradual rollout of new features.
 *
 * Feature flags are controlled via environment variables.
 * All flags default to false (unset) for safety — features must be explicitly enabled.
 */

import { error } from '@chm/logger'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'

/**
 * Feature flag definitions.
 *
 * Each flag is a function that reads the environment variable at runtime.
 * This allows flags to be changed without rebuilding the application.
 */
export const featureFlags = {
  /**
   * Enable persistent database storage for AI agent conversations.
   *
   * When enabled, conversations are stored in D1 (Cloudflare Workers) or PostgreSQL
   * instead of localStorage. Requires Clerk to be fully enabled — provider
   * `clerk` AND a real publishable key — because the server store isolates
   * conversations per signed-in user. Without a key there is no user identity,
   * so we fall back to the localStorage adapter instead of calling the server
   * endpoint (which would 501 on guest/self-hosted deployments).
   *
   * @default false (unset)
   * @env VITE_FEATURE_CONVERSATION_DB (was NEXT_PUBLIC_FEATURE_CONVERSATION_DB)
   */
  conversationDb: (): boolean => {
    if (import.meta.env.VITE_FEATURE_CONVERSATION_DB !== 'true') {
      return false
    }

    try {
      return isClerkEnabled()
    } catch (err) {
      error('[featureFlags.conversationDb] Clerk enablement check failed', err)
      return false
    }
  },

  /**
   * Enable server-side database storage for per-user ClickHouse connections.
   *
   * Requires Clerk auth and a configured D1/Postgres backend on the server.
   *
   * @default false (unset)
   * @env VITE_FEATURE_USER_CONNECTIONS_DB
   */
  userConnectionsDb: (): boolean => {
    if (import.meta.env.VITE_FEATURE_USER_CONNECTIONS_DB !== 'true') {
      return false
    }

    try {
      return isClerkEnabled()
    } catch (err) {
      error(
        '[featureFlags.userConnectionsDb] Clerk enablement check failed',
        err
      )
      return false
    }
  },

  /**
   * Enable the outbound webhook subscriptions UI (plan 44).
   *
   * Requires Clerk auth and a configured D1 backend on the server — see
   * `lib/events/server-feature.ts`.
   *
   * @default false (unset)
   * @env VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS
   */
  webhookSubscriptions: (): boolean => {
    if (import.meta.env.VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS !== 'true') {
      return false
    }

    try {
      return isClerkEnabled()
    } catch (err) {
      error(
        '[featureFlags.webhookSubscriptions] Clerk enablement check failed',
        err
      )
      return false
    }
  },
} as const

/**
 * Type-safe feature flag names.
 */
export type FeatureFlagName = keyof typeof featureFlags

/**
 * Check if a feature flag is enabled.
 *
 * @param flag - Feature flag name
 * @returns true if the flag is enabled
 *
 * @example
 * ```ts
 * if (isFeatureEnabled('conversationDb')) {
 *   // Use database storage
 * } else {
 *   // Use localStorage
 * }
 * ```
 */
export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  return featureFlags[flag]()
}
