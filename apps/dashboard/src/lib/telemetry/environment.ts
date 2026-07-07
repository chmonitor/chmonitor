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

/**
 * Returns the deployment target inlined at build time via VITE_DEPLOY_TARGET.
 * Falls back to 'unknown' when the var is absent (e.g. local dev without it
 * set, or a Docker build that doesn't set it yet).
 */
export function getDeployTarget(): DeployTarget {
  const raw = import.meta.env.VITE_DEPLOY_TARGET?.trim().toLowerCase()
  const VALID: DeployTarget[] = ['docker', 'helm', 'cf', 'dev', 'unknown']
  if (raw && (VALID as string[]).includes(raw)) return raw as DeployTarget
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
  const match = version.match(/^(\d+)\.(\d+)/)
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
export function detectChFlavor(version: string | null | undefined): ChFlavor {
  if (!version) return 'unknown'
  if (version.toLowerCase().includes('altinity')) return 'altinity'
  // Accept any string that starts with digits (a version number)
  if (/^\d/.test(version.trim())) return 'oss'
  return 'unknown'
}

/**
 * Detect country from browser timezone (privacy-safe alternative to IP geolocation).
 * Returns ISO 3166-1 alpha-2 country code or 'unknown'.
 *
 * Privacy contract:
 *   - Uses timezone mapping, NOT IP geolocation (no IP involved)
 *   - Returns 'unknown' when timezone cannot be mapped to a country
 *   - Uses Intl API which is built into the browser
 */
export function detectCountry(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!timezone) return 'unknown'

    // Map common timezones to countries (simplified, privacy-safe)
    const tzToCountry: Record<string, string> = {
      'America/New_York': 'us',
      'America/Chicago': 'us',
      'America/Denver': 'us',
      'America/Los_Angeles': 'us',
      'America/Phoenix': 'us',
      'Europe/London': 'gb',
      'Europe/Paris': 'fr',
      'Europe/Berlin': 'de',
      'Europe/Madrid': 'es',
      'Europe/Rome': 'it',
      'Asia/Tokyo': 'jp',
      'Asia/Shanghai': 'cn',
      'Asia/Hong_Kong': 'hk',
      'Asia/Singapore': 'sg',
      'Asia/Seoul': 'kr',
      'Asia/Dubai': 'ae',
      'Asia/Kolkata': 'in',
      'Australia/Sydney': 'au',
      'Australia/Melbourne': 'au',
      'Pacific/Auckland': 'nz',
    }

    return tzToCountry[timezone] || 'unknown'
  } catch {
    return 'unknown'
  }
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
