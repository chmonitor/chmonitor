// Defensive redaction for telemetry props.
//
// Callers are expected to pass only non-identifying values (counts, enums,
// booleans, durations). This is the belt-and-suspenders net that runs before
// any event leaves the process: it drops props whose KEY names sensitive data,
// and string VALUES that look like PII, a host, or a URL. Privacy-first — when
// in doubt, drop.

import type { TelemetryProps } from './events'

// Instance-ping only. Generic `track()` still drops `license_key` (token-like).
// Polar checkout id is allowlisted on the daily ping so licensed installs can
// be counted without attaching the raw key to product events.
export const PING_ALLOWLISTED_KEYS = new Set(['license_key'])

// Key tokens that imply sensitive content. Matched as whole `_`/camelCase
// tokens (not substrings), so `tooltip`/`clip_count` are NOT blocked while
// `host`/`ip`/`query` are. Conservative on purpose: a dropped count is cheap,
// a leaked hostname is not.
const BLOCKED_KEY_TOKENS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'credential',
  'credentials',
  'email',
  'dsn',
  'sql',
  'query',
  'statement',
  'ddl',
  'host',
  'hostname',
  'ip',
  'addr',
  'address',
  'url',
  'uri',
  'endpoint',
])

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2') // camelCase → snake_case
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function isBlockedKey(key: string): boolean {
  const tokens = keyTokens(key)
  const joined = tokens.join('')
  // `license_key` / `licenseKey` — purchase identifier, not a track() prop.
  if (joined === 'licensekey') return true
  if (tokens.some((token) => BLOCKED_KEY_TOKENS.has(token))) return true
  // Catch separator-less spellings like `apiKey` → `apikey`.
  return joined.includes('apikey')
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w][\w.-]*/
const IPV4_RE = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/
const IPV6_RE = /\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/i
const URLISH_RE = /:\/\//

export function looksSensitive(value: string): boolean {
  return (
    EMAIL_RE.test(value) ||
    IPV4_RE.test(value) ||
    IPV6_RE.test(value) ||
    URLISH_RE.test(value)
  )
}

export function redactProps(
  props: TelemetryProps,
  options?: { allowKeys?: ReadonlySet<string> }
): TelemetryProps {
  const allowKeys = options?.allowKeys
  const out: TelemetryProps = {}
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue
    const allowlisted = allowKeys?.has(key) === true
    if (!allowlisted && isBlockedKey(key)) continue
    if (typeof value === 'string' && looksSensitive(value)) continue
    out[key] = value
  }
  return out
}

/** Redact a ping payload, keeping allowlisted fields such as `license_key`. */
export function redactPingPayload(
  props: Record<string, string>
): Record<string, string> {
  const redacted = redactProps(props, { allowKeys: PING_ALLOWLISTED_KEYS })
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(redacted)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}
