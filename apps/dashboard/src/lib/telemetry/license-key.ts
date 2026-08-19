// Optional commercial-license identifier for the instance ping.
//
// CHM_LICENSE_KEY is the Polar checkout id from the receipt — the same id
// lookup already accepts. Cloud-hooks does not mint a dedicated key. Honor
// system: the value is never used to gate features or fail startup.

/** Polar checkout ids are UUIDs (36 chars). Cap above that for order-id variants. */
export const LICENSE_KEY_MAX_LEN = 80
export const LICENSE_KEY_MIN_LEN = 8

// Polar checkout / order ids are UUID-shaped (`8-4-4-4-12` hex). Accept the
// same charset lookup already uses (no email, no URL). Do not invent a prefix.
const LICENSE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/

/**
 * Trim and accept a Polar checkout / order id. Returns undefined when unset,
 * empty, too long, or not the existing identifier charset.
 */
export function sanitizeLicenseKey(
  raw: string | null | undefined
): string | undefined {
  if (raw == null) return undefined
  const trimmed = raw.trim()
  if (
    trimmed.length < LICENSE_KEY_MIN_LEN ||
    trimmed.length > LICENSE_KEY_MAX_LEN
  ) {
    return undefined
  }
  if (!LICENSE_KEY_RE.test(trimmed)) return undefined
  return trimmed
}

/**
 * Read `CHM_LICENSE_KEY` from runtime env (Worker binding / process.env /
 * an injected map). Same pattern as `CHM_TELEMETRY`: unset means omit.
 */
export function getLicenseKey(
  runtimeEnv?: Record<string, string | undefined>
): string | undefined {
  const source =
    runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {})
  return sanitizeLicenseKey(source.CHM_LICENSE_KEY)
}
