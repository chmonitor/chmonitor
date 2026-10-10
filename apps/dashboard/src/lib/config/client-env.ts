// Build-time derivation of the auth + boolean feature VITE_* constants that
// vite.config.ts bakes into the bundle. Pure and alias-free so vite.config.ts
// can import it by relative path and a unit test can pin its output.

import { parseBool } from './parse-bool'

type BuildEnv = Record<string, string | undefined>

/**
 * Bake a boolean flag as the literal 'true' / 'false', so every client reader
 * sees one canonical form. An explicit value is parsed with the shared grammar
 * (`=1` / `=yes` → 'true'); an explicit but unrecognised value fails closed to
 * 'false'. Unset / empty → the mode default.
 */
export function bakeBool(
  raw: string | undefined,
  fallback: boolean
): 'true' | 'false' {
  if (raw === undefined || raw.trim() === '') return fallback ? 'true' : 'false'
  return parseBool(raw) === true ? 'true' : 'false'
}

/** First non-empty value — an empty string means "unset", not "off". */
function pick(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => v !== undefined && v !== '')
}

/**
 * The auth + feature-flag VITE_* constants. Precedence per var:
 * explicit VITE_* → canonical CHM_* → mode default.
 *
 * VITE_AUTH_PROVIDER is baked ONLY when explicitly set. Leaving it empty lets
 * the server resolve runtime CHM_AUTH_PROVIDER / CHM_DEPLOYMENT_MODE first, and
 * the client falls back to the baked VITE_DEPLOYMENT_MODE default
 * (getBuildAuthProvider in lib/auth/provider.ts).
 */
export function resolveClientFlagEnv(e: BuildEnv, isCloud: boolean) {
  return {
    VITE_AUTH_PROVIDER: pick(e.VITE_AUTH_PROVIDER, e.CHM_AUTH_PROVIDER) ?? '',
    VITE_FEATURE_CONVERSATION_DB: bakeBool(
      pick(e.VITE_FEATURE_CONVERSATION_DB, e.CHM_FEATURE_CONVERSATION_DB),
      isCloud
    ),
    VITE_FEATURE_USER_CONNECTIONS_DB: bakeBool(
      pick(
        e.VITE_FEATURE_USER_CONNECTIONS_DB,
        e.CHM_FEATURE_USER_CONNECTIONS_DB
      ),
      isCloud
    ),
    // Outbound webhook subscriptions (plan 44) — same D1 + Clerk requirement as
    // user-connections, own flag so an operator can enable one without the other.
    VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS: bakeBool(
      pick(
        e.VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS,
        e.CHM_FEATURE_WEBHOOK_SUBSCRIPTIONS
      ),
      isCloud
    ),
    // Postgres source engine (RFC #2264, phase 1 #2448). Fail-closed: default
    // off in BOTH modes until Postgres connectivity lands — not `isCloud`-gated.
    VITE_FEATURE_POSTGRES_SOURCE: bakeBool(
      pick(e.VITE_FEATURE_POSTGRES_SOURCE, e.CHM_FEATURE_POSTGRES_SOURCE),
      false
    ),
    // $199 "Fleet" mid-anchor tier experiment (#2381). Fail-closed: default off
    // in both modes — a presentation-only pricing A/B, not `isCloud`-gated.
    VITE_FEATURE_FLEET_TIER: bakeBool(
      pick(e.VITE_FEATURE_FLEET_TIER, e.CHM_FEATURE_FLEET_TIER),
      false
    ),
  }
}
