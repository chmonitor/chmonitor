// Anonymous environment dimensions for telemetry events.
//
// All helpers are pure (no side effects, no network) and safe to call on both
// the client and the server. They return undefined / 'unknown' rather than
// throwing when data is absent.
//
// Redaction safety contract:
//   - `getDeployTarget()` returns a short enum string (e.g. 'cf', 'docker').
//   - `parseMajorMinor()` returns at most "MAJOR.MINOR" (e.g. '24.8') —
//     never a 4-part version like '24.8.1.2' which would collide with the
//     IPv4 redaction pattern in redact.ts.
//   - `detectChFlavor()` returns a short enum string.
// None of these values match the email/IPv4/IPv6/URL patterns in redact.ts.

export type DeployTarget = 'docker' | 'helm' | 'cf' | 'dev' | 'unknown'
export type ChFlavor = 'oss' | 'altinity' | 'cloud' | 'unknown'

const INJECTED_TARGETS: readonly string[] = [
  'docker',
  'helm',
  'cf',
  'dev',
  'unknown',
] satisfies DeployTarget[]

function isInjectedDeployTarget(value: string): value is DeployTarget {
  return INJECTED_TARGETS.includes(value)
}

/**
 * Returns the deployment target inlined at build time via VITE_DEPLOY_TARGET.
 * Falls back to 'unknown' when the var is absent (e.g. local dev without it
 * set, or a Docker build that doesn't set it yet).
 */
export function getDeployTarget(): DeployTarget {
  // 1. Check if server-injected target is available in the browser window
  if (typeof window !== 'undefined' && window.__CHM_DEPLOY_TARGET__) {
    const injected = window.__CHM_DEPLOY_TARGET__
    if (isInjectedDeployTarget(injected)) return injected
  }

  // 2. Build-time env variable override. 'unknown' is treated as unset so a
  // defaulted vite `?? 'unknown'` does not skip hostname heuristics (that
  // was tagging almost every ping as unknown).
  const raw = import.meta.env.VITE_DEPLOY_TARGET?.trim().toLowerCase()
  const VALID: DeployTarget[] = ['docker', 'helm', 'cf', 'dev']
  if (raw && (VALID as string[]).includes(raw)) return raw as DeployTarget

  // 3. Fallback: server-side process env inspection (SSR)
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.KUBERNETES_SERVICE_HOST || process.env.KUBERNETES_PORT) {
      return 'helm'
    }
    if (process.env.DOCKER_CONTAINER || process.env.NODE_ENV === 'production') {
      return 'docker'
    }
    if (process.env.NODE_ENV === 'development') {
      return 'dev'
    }
  }

  // 4. Client-side hostname heuristics
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.local')
    ) {
      return 'dev'
    }
    if (
      host.endsWith('.workers.dev') ||
      host.endsWith('.pages.dev') ||
      host === 'dash.chmonitor.dev' ||
      host === 'telemetry.chmonitor.dev'
    ) {
      return 'cf'
    }
    // Default fallback for self-hosted domain deployments is typically docker
    return 'docker'
  }

  return 'unknown'
}

/**
 * Extracts the "MAJOR.MINOR" portion from a ClickHouse version string.
 *
 * Examples:
 *   parseMajorMinor('24.8.1.2')           → '24.8'
 *   parseMajorMinor('24.8')               → '24.8'
 *   parseMajorMinor('24.8.5.7-altinity') → '24.8'
 *   parseMajorMinor('')                   → undefined
 *   parseMajorMinor(null)                 → undefined
 *
 * Returning only MAJOR.MINOR (never the full 4-part version) is intentional:
 * a string like '24.8.1.2' matches the IPv4 redaction regex and would be
 * silently dropped before reaching the telemetry sink.
 */
export function parseMajorMinor(
  version: string | null | undefined
): string | undefined {
  if (!version) return undefined
  const match = version.match(/(\d+)\.(\d+)/)
  if (!match) return undefined
  return `${match[1]}.${match[2]}`
}

/**
 * Best-effort ClickHouse flavor detection from the version() string.
 *
 * - 'altinity' — version contains "altinity" (case-insensitive).
 * - 'oss'      — version looks like a normal semver / 4-part number.
 * - 'unknown'  — version is absent or unparseable.
 *
 * Note on 'cloud': ClickHouse Cloud version strings are not reliably
 * distinguishable from community builds via version() alone (they look like
 * normal 4-part versions). We do NOT guess 'cloud' here to avoid false
 * positives — if a reliable cloud marker is found in the future, add it then.
 */
export function detectChFlavor(
  version: string | null | undefined,
  hostname?: string | null
): ChFlavor {
  const host = hostname?.toLowerCase() ?? ''
  if (
    host.includes('clickhouse.cloud') ||
    host.includes('.aws.clickhouse.') ||
    host.includes('.gcp.clickhouse.') ||
    host.includes('.azure.clickhouse.')
  ) {
    return 'cloud'
  }
  if (!version) return 'unknown'
  if (version.toLowerCase().includes('altinity')) return 'altinity'
  if (version.toLowerCase().includes('cloud')) return 'cloud'
  // Accept any string that contains a leading version number
  if (/\d+\.\d+/.test(version)) return 'oss'
  return 'unknown'
}

/**
 * Detect platform/OS from navigator.userAgent (generic categories only).
 * Returns 'windows', 'macos', 'linux', 'android', 'ios', or 'unknown'.
 *
 * Privacy contract:
 *   - Only generic OS families, not specific versions
 *   - Returns 'unknown' when userAgent is unavailable or unparseable
 *   - No device fingerprinting or unique identifiers
 */
export function detectPlatform(): string {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return 'unknown'
  }

  const ua = navigator.userAgent.toLowerCase()

  if (ua.includes('android')) return 'android'
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios'
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos'
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('linux')) return 'linux'

  return 'unknown'
}

declare global {
  interface Window {
    /** Set by the inline script in `routes/__root.tsx`. */
    __CHM_DEPLOY_TARGET__?: string
  }
}
