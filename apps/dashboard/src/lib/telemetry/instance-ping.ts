// Daily anonymous instance ping, sent to the shared telemetry service as a
// `ping` event.
//
// Privacy contract (CRITICAL):
//   - Completely inert unless BOTH conditions hold:
//     1. Telemetry is enabled (on by default; off via CHM_TELEMETRY=off, DO_NOT_TRACK, ...).
//     2. A collection endpoint resolves (CHM_TELEMETRY_ENDPOINT / VITE_TELEMETRY_ENDPOINT,
//        or the default). An empty endpoint is a hard kill-switch.
//   - NO network call is made if either condition is absent.
//   - No license key, deployment-location hash or client-derived country is
//     sent. A license key is an identifier and must never reach public
//     telemetry; the server derives the country itself.
//   - Only the HASH of a per-install identifier is transmitted — the raw value
//     never leaves the device. It is a SHA-256 over a random per-install secret
//     plus the dashboard and ClickHouse hostnames, so treat the id as
//     pseudonymous rather than anonymous: the hash is of a partly low-entropy
//     string, and both hostnames are recoverable by dictionary attack.
//   - ClickHouse version is truncated to MAJOR.MINOR (e.g. '24.8') so it cannot
//     be mistaken for an IPv4 address and cannot fingerprint a specific patch release.

import { isTelemetryEnabled } from './config'
import { DEFAULT_TELEMETRY_ENDPOINT } from './endpoint'
import {
  detectChFlavor,
  detectPlatform,
  getDeployTarget,
  parseMajorMinor,
} from './environment'
import { redactProps } from './redact'
import { APP_VERSION } from '@/lib/whats-new/app-version'

export const PING_INTERVAL_MS = 24 * 60 * 60 * 1000

const FETCH_TIMEOUT_MS = 5_000

export const STORAGE_KEY_INSTANCE_ID = 'chm_telemetry_instance_id'
const STORAGE_KEY_LAST_PING = 'chm_telemetry_last_ping_at'
export const STORAGE_KEY_INSTANCE_SECRET = 'chm_telemetry_instance_secret'
export const STORAGE_KEY_CH_HOSTNAME = 'chm_telemetry_ch_hostname'

export { DEFAULT_TELEMETRY_ENDPOINT }

/** CHM product version (semver, no leading `v`). Git refs are not accepted by the collector. */
export function getChmVersion(): string | undefined {
  return APP_VERSION.replace(/^v/, '') || undefined
}

export function shouldPing(
  now: number,
  lastPingAt: number | null,
  intervalMs: number = PING_INTERVAL_MS,
  lastPingVersion?: string | null,
  newVersion?: string
): boolean {
  if (lastPingAt === null) return true
  if (!lastPingVersion && newVersion) return true
  return now - lastPingAt >= intervalMs
}

/** Wire shape of one event accepted by the shared telemetry service. */
export interface PingPayload {
  event: 'ping'
  /** The instance hash — same value as before, so counts stay continuous. */
  id: string
  /** CHM product version. */
  version?: string
  os?: string
  props: Record<string, string>
}

/**
 * Builds the `ping` event sent to the collection endpoint.
 * Only safe, non-identifying fields are included.
 * Undefined values are omitted.
 *
 * `version` is the ClickHouse server version (reported as `props.ch_version`,
 * truncated to major.minor); `chmVersion` is the product version and becomes the
 * top-level `version`.
 */
export function buildPingPayload(input: {
  instanceHash: string
  version?: string
  deployTarget: string
  chFlavor?: string
  platform?: string
  chmVersion?: string
}): PingPayload {
  const {
    instanceHash,
    version,
    deployTarget,
    chFlavor,
    platform,
    chmVersion,
  } = input
  const chVersion = version ? parseMajorMinor(version) : undefined
  const props: Record<string, string> = { deploy_target: deployTarget }
  if (chVersion !== undefined) {
    props.ch_version = chVersion
  }
  if (chFlavor !== undefined) {
    props.ch_flavor = chFlavor
  }
  const payload: PingPayload = {
    event: 'ping',
    id: instanceHash,
    props: stringProps(redactProps(props)),
  }
  if (chmVersion !== undefined) {
    payload.version = chmVersion
  }
  if (platform !== undefined) {
    payload.os = platform
  }
  return payload
}

function stringProps(
  props: Record<string, string | number | boolean | undefined>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/**
 * Resolves the telemetry collection endpoint.
 * Server: CHM_TELEMETRY_ENDPOINT from runtimeEnv.
 * Client: VITE_TELEMETRY_ENDPOINT inlined at build time.
 * Falls back to DEFAULT_TELEMETRY_ENDPOINT when the env var is unset.
 * An explicit empty string ('') is preserved and treated by callers as
 * "no endpoint" — a hard kill-switch for the network call.
 */
export function getPingEndpoint(
  runtimeEnv?: Record<string, string | undefined>
): string {
  if (runtimeEnv) {
    return runtimeEnv.CHM_TELEMETRY_ENDPOINT ?? DEFAULT_TELEMETRY_ENDPOINT
  }
  return import.meta.env.VITE_TELEMETRY_ENDPOINT ?? DEFAULT_TELEMETRY_ENDPOINT
}

export type PingResult =
  | 'skipped-disabled'
  | 'skipped-no-endpoint'
  | 'skipped-too-soon'
  | 'pinged'

export interface PingDeps {
  enabled: boolean
  endpoint: string
  now: number
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  randomId: () => string
  hash: (s: string) => Promise<string>
  post: (url: string, body: string) => Promise<void>
  version?: string
  chHostname?: string
  deployTarget: string
  detectFlavor: (
    version: string | null | undefined,
    hostname?: string | null
  ) => string
  detectPlatform: () => string
  chmVersion?: string
}

/**
 * Reads the per-install random secret, minting and persisting one on first use.
 * It never leaves the device; it only raises the entropy of the string that gets
 * hashed, so the instance id cannot be reversed by dictionary attack on the
 * hostnames.
 */
export function getOrCreateInstanceSecret(
  getItem: (k: string) => string | null,
  setItem: (k: string, v: string) => void,
  randomId: () => string
): string {
  const stored = getItem(STORAGE_KEY_INSTANCE_SECRET)
  if (stored) return stored
  const secret = randomId()
  setItem(STORAGE_KEY_INSTANCE_SECRET, secret)
  return secret
}

/**
 * Builds and persists the raw instance id: the per-install secret joined to the
 * dashboard and ClickHouse hostnames. The caller hashes it; the raw string never
 * leaves the device. Shared by the ping and the event sink so both mint the same
 * id for the same install.
 */
export function buildInstanceId(
  chHostname: string,
  getItem: (k: string) => string | null,
  setItem: (k: string, v: string) => void,
  randomId: () => string
): string {
  // Always persist a secret, including off-browser (SSR/prerender/tests): the
  // legacy check treats "id without a secret" as pre-salt, so an id minted
  // without one would be re-minted on every subsequent call.
  const secret = getOrCreateInstanceSecret(getItem, setItem, randomId)
  const id =
    typeof window === 'undefined' || !window.location
      ? secret
      : `${secret}|${window.location.hostname}|${chHostname || 'default'}`
  setItem(STORAGE_KEY_INSTANCE_ID, id)
  if (chHostname) setItem(STORAGE_KEY_CH_HOSTNAME, chHostname)
  return id
}

/**
 * Core ping orchestration.  All side-effects come through deps — unit tests
 * pass fake implementations to exercise every branch without touching real
 * browser globals or making real HTTP calls.
 *
 * Error contract: post() errors are caught internally — a failing POST does NOT
 * cause runInstancePing to reject.  The app-facing maybePingInstance wrapper
 * additionally swallows all errors from runInstancePing itself.
 */
export async function runInstancePing(deps: PingDeps): Promise<PingResult> {
  const {
    enabled,
    endpoint,
    now,
    getItem,
    setItem,
    randomId,
    hash,
    post,
    version,
    deployTarget,
    detectFlavor,
    detectPlatform,
    chmVersion,
  } = deps

  if (!enabled) return 'skipped-disabled'
  if (!endpoint) return 'skipped-no-endpoint'

  const rawLastPing = getItem(STORAGE_KEY_LAST_PING)
  const lastPingAt = rawLastPing !== null ? Number(rawLastPing) : null
  const lastPingVersion = getItem('chm_telemetry_last_ping_version')
  if (
    !shouldPing(now, lastPingAt, PING_INTERVAL_MS, lastPingVersion, version)
  ) {
    return 'skipped-too-soon'
  }

  // Get-or-create stable local instance ID (never transmitted raw)
  let instanceId = getItem(STORAGE_KEY_INSTANCE_ID)
  const currentChHostname = deps.chHostname || ''
  const storedChHostname = getItem(STORAGE_KEY_CH_HOSTNAME) || ''
  // A stored id with no secret predates the salt: re-mint once so an upgraded
  // install stops shipping the reversible `hostname|chHostname` id forever.
  const isLegacyId =
    Boolean(instanceId) && !getItem(STORAGE_KEY_INSTANCE_SECRET)

  if (
    !instanceId ||
    isLegacyId ||
    (currentChHostname && currentChHostname !== storedChHostname)
  ) {
    instanceId = buildInstanceId(currentChHostname, getItem, setItem, randomId)
  }

  const instanceHash = await hash(instanceId)
  const chFlavor = detectFlavor(version, deps.chHostname)
  const platform = detectPlatform()

  const payload = buildPingPayload({
    instanceHash,
    version,
    deployTarget,
    chFlavor,
    platform,
    chmVersion,
  })

  try {
    await post(endpoint, JSON.stringify(payload))
  } catch {
    // A failed network call must never crash the app — silently continue.
  }

  // Persist timestamp regardless of whether post succeeded.  This prevents
  // hammering a broken endpoint every page load.
  setItem(STORAGE_KEY_LAST_PING, String(now))
  if (version) {
    setItem('chm_telemetry_last_ping_version', version)
  }

  return 'pinged'
}

export async function sha256hex(s: string): Promise<string> {
  const enc = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Fire-and-forget instance ping for browser environments.
 *
 * - Safe to call unconditionally: returns immediately (no-op) when telemetry
 *   is off or when no collection endpoint is configured.
 * - Swallows ALL errors — a failed ping must never affect the app.
 * - Guards against non-browser environments (SSR, prerender, unit tests).
 */
export function maybePingInstance(
  runtimeEnv?: Record<string, string | undefined>,
  chVersion?: string,
  chHostname?: string
): void {
  if (
    typeof window === 'undefined' ||
    typeof localStorage === 'undefined' ||
    typeof crypto === 'undefined' ||
    typeof crypto.subtle === 'undefined' ||
    typeof crypto.randomUUID !== 'function'
  ) {
    return
  }

  const enabled = isTelemetryEnabled(runtimeEnv)
  const endpoint = getPingEndpoint(runtimeEnv)

  // Quick synchronous bail-out avoids even building the deps object.
  if (!enabled || !endpoint) return

  const deps: PingDeps = {
    enabled,
    endpoint,
    now: Date.now(),
    getItem: (k) => {
      try {
        return localStorage.getItem(k)
      } catch {
        return null
      }
    },
    setItem: (k, v) => {
      try {
        localStorage.setItem(k, v)
      } catch {
        // localStorage may be unavailable (private browsing, quota exceeded)
      }
    },
    randomId: () => crypto.randomUUID(),
    hash: sha256hex,
    post: (url, body) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }).then(() => undefined),
    version: chVersion, // caller may populate via a separate ClickHouse query
    chHostname,
    deployTarget: getDeployTarget(),
    detectFlavor: detectChFlavor,
    detectPlatform: detectPlatform,
    chmVersion: getChmVersion(),
  }

  // Fire-and-forget — errors are swallowed by runInstancePing + this catch.
  runInstancePing(deps).catch(() => {})
}
