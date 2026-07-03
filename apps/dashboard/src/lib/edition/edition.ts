// Open-core edition boundary.
//
// Core is GPL-3.0 and free forever. This module is the honest boundary between
// community (OSS, self-hosted, single operator, fully functional) and enterprise
// (paid features for large organisations: alerting, SSO, RBAC, fleet, cloud).
//
// Design invariant: FAIL-OPEN to community. An unset, empty, or unrecognised
// CHM_EDITION / VITE_EDITION NEVER locks a self-hoster out. The free edition is
// fully functional — enterprise gates only features that do not exist in community.

export type Edition = 'community' | 'enterprise'

/**
 * All features that are gated to enterprise edition.
 * Community edition will return false for these — they simply do not exist yet
 * in the OSS build, so this does NOT degrade free functionality.
 */
export const ENTERPRISE_FEATURES = [
  'alerting',
  'sso',
  'rbac',
  'fleet',
  'cloud',
  'audit',
] as const

export type EditionFeature = (typeof ENTERPRISE_FEATURES)[number]

/**
 * Normalise a raw env string to an Edition.
 *
 * Only the exact string 'enterprise' (case-insensitive, trimmed) maps to
 * enterprise. Everything else — undefined, empty string, whitespace, junk —
 * returns 'community'. Does NOT throw; callers always get a valid edition.
 */
export function parseEdition(value: string | null | undefined): Edition {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'enterprise') return 'enterprise'
  return 'community'
}

/**
 * Resolve the current edition at runtime.
 *
 * Resolution order:
 *   1. runtimeEnv.CHM_EDITION   (Cloudflare Worker [vars] / process.env on Node)
 *   2. import.meta.env.VITE_EDITION  (build-time inline, set in vite.config CLIENT_ENV)
 *
 * Pass the Cloudflare `env` binding on the edge; defaults to process.env on Node.
 * Unknown or unset values always resolve to 'community' (fail-open).
 */
export function getEdition(
  runtimeEnv?: Record<string, string | undefined>
): Edition {
  const source =
    runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {})
  return parseEdition(source.CHM_EDITION ?? import.meta.env.VITE_EDITION)
}

/**
 * Return true only when the given feature is available in the resolved edition.
 *
 * All ENTERPRISE_FEATURES return false in community — they are not degraded
 * versions of community features, they simply do not exist in the OSS build.
 */
export function isEnabled(
  feature: EditionFeature,
  runtimeEnv?: Record<string, string | undefined>
): boolean {
  if (ENTERPRISE_FEATURES.includes(feature)) {
    return getEdition(runtimeEnv) === 'enterprise'
  }
  return true
}
