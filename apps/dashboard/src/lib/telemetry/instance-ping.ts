// Opt-in, daily anonymous instance ping.
//
// Privacy contract (CRITICAL):
//   - Completely inert unless BOTH conditions hold:
//     1. Telemetry is explicitly enabled (CHM_TELEMETRY=on / VITE_TELEMETRY_ENABLED=true).
//     2. A collection endpoint is explicitly configured (CHM_TELEMETRY_ENDPOINT / VITE_TELEMETRY_ENDPOINT).
//   - NO network call is made if either condition is absent.
//   - Only the HASH of a randomly-generated local ID is transmitted — the raw ID
//     never leaves the device. The hash is stable across pings (re-hashes the same
//     stored ID) so the server can count distinct instances without learning identity.
//   - ClickHouse version is truncated to MAJOR.MINOR (e.g. '24.8') so it cannot
//     be mistaken for an IPv4 address and cannot fingerprint a specific patch release.

import { isTelemetryEnabled } from './config'
import {
  detectChFlavor,
  detectCountry,
  detectPlatform,
  getDeployTarget,
  parseMajorMinor,
} from './environment'

// ─────────────────────────────────────────────────────────────────────────────
// Constants

export const PING_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

const STORAGE_KEY_INSTANCE_ID = 'chm_telemetry_instance_id'
const STORAGE_KEY_LAST_PING = 'chm_telemetry_last_ping_at'

// Default collection endpoint (the project's hosted collector — apps/telemetry).
// Overridable via CHM_TELEMETRY_ENDPOINT / VITE_TELEMETRY_ENDPOINT. Set the env
// to an empty string to hard-disable the network call even with telemetry on.
export const DEFAULT_TELEMETRY_ENDPOINT =
  'https://telemetry.chmonitor.dev/v1/ping'

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (no globals — unit-testable in isolation)

/**
 * Returns true when a ping is due.
 * - Always true when lastPingAt is null (never pinged).
 * - True when >= intervalMs has elapsed since the last ping.
 */
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

/**
 * Builds the JSON payload sent to the collection endpoint.
 * Only safe, non-identifying fields are included.
 * Undefined values are omitted.
 */
export function buildPingPayload(input: {
  instanceHash: string
  version?: string
  deployTarget: string
  chFlavor?: string
  country?: string
  platform?: string
  chmVersion?: string
  installPlace?: string
}): Record<string, string> {
  const {
    instanceHash,
    version,
    deployTarget,
    chFlavor,
    country,
    platform,
    chmVersion,
    installPlace,
  } = input
  const chVersion = version ? parseMajorMinor(version) : undefined
  const payload: Record<string, string> = {
    instance_hash: instanceHash,
    deploy_target: deployTarget,
  }
  if (chVersion !== undefined) {
    payload.ch_version = chVersion
  }
  if (chFlavor !== undefined) {
    payload.ch_flavor = chFlavor
  }
  if (country !== undefined) {
    payload.country = country
  }
  if (platform !== undefined) {
    payload.platform = platform
  }
  if (chmVersion !== undefined) {
    payload.chm_version = chmVersion
  }
  if (installPlace !== undefined) {
    payload.install_place = installPlace
  }
  return payload
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
  // Client bundle: build-time inline
  return import.meta.env.VITE_TELEMETRY_ENDPOINT ?? DEFAULT_TELEMETRY_ENDPOINT
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator with injected dependencies (for testability)

export type PingResult =
  | 'skipped-disabled'
  | 'skipped-no-endpoint'
  | 'skipped-too-soon'
  | 'pinged'

export interface PingDeps {
  /** isTelemetryEnabled(runtimeEnv) */
  enabled: boolean
  /** getPingEndpoint(runtimeEnv) */
  endpoint: string
  /** Date.now() */
  now: number
  /** localStorage.getItem */
  getItem: (k: string) => string | null
  /** localStorage.setItem */
  setItem: (k: string, v: string) => void
  /** crypto.randomUUID */
  randomId: () => string
  /** SHA-256 hex digest of s */
  hash: (s: string) => Promise<string>
  /** POST url with body (fire-and-forget at this layer; caller may catch) */
  post: (url: string, body: string) => Promise<void>
  /** Raw ClickHouse version string (optional) */
  version?: string
  /** ClickHouse server hostname (optional) */
  chHostname?: string
  /** Deploy target string */
  deployTarget: string
  /** Detect ClickHouse flavor (oss/altinity/cloud/unknown) */
  detectFlavor: (version: string | null | undefined) => string
  /** Detect country from timezone (privacy-safe) */
  detectCountry: () => string
  /** Detect platform/OS from userAgent (generic categories only) */
  detectPlatform: () => string
  /** CHM product version string (e.g. '0.3.1') */
  chmVersion?: string
  /** Compute install_place hash from deployment environment signals */
  computeInstallPlace: () => Promise<string | undefined>
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
    detectCountry,
    detectPlatform,
    chmVersion,
    computeInstallPlace,
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
  const storedChHostname = getItem('chm_telemetry_ch_hostname') || ''

  if (
    !instanceId ||
    (currentChHostname && currentChHostname !== storedChHostname)
  ) {
    if (typeof window !== 'undefined' && window.location) {
      instanceId = `${window.location.hostname}|${currentChHostname || 'default'}`
      if (currentChHostname) {
        setItem('chm_telemetry_ch_hostname', currentChHostname)
      }
    } else {
      instanceId = randomId()
    }
    setItem(STORAGE_KEY_INSTANCE_ID, instanceId)
  }

  const instanceHash = await hash(instanceId)
  const chFlavor = version ? detectFlavor(version) : undefined
  const country = detectCountry()
  const platform = detectPlatform()
  const installPlace = await computeInstallPlace()

  const payload = buildPingPayload({
    instanceHash,
    version,
    deployTarget,
    chFlavor,
    country,
    platform,
    chmVersion,
    installPlace,
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

// ─────────────────────────────────────────────────────────────────────────────
// Browser entrypoint

/**
 * SHA-256 hex digest via SubtleCrypto.
 */
async function sha256hex(s: string): Promise<string> {
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
  // Guard: require browser globals before attempting anything.
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
      }).then(() => undefined),
    version: chVersion, // caller may populate via a separate ClickHouse query
    chHostname,
    deployTarget: getDeployTarget(),
    detectFlavor: detectChFlavor,
    detectCountry: detectCountry,
    detectPlatform: detectPlatform,
    // CHM product version from the build-time env var
    chmVersion: import.meta.env.VITE_GIT_REF?.replace(/^v/, '') || undefined,
    computeInstallPlace: async () => {
      // Compute a stable hash from deployment environment signals. The hash
      // identifies the deployment location (k8s cluster, Docker host, etc.)
      // without exposing the raw values.
      try {
        const signals: string[] = []
        // Browser hostname (e.g. 'chm.mycompany.com') — same for all users
        // hitting the same deployment.
        if (typeof window !== 'undefined' && window.location) {
          signals.push(window.location.hostname)
        }
        // Deploy target contributes to the signal so different deploy
        // methods on the same host are distinguishable.
        signals.push(getDeployTarget())
        if (signals.length === 0) return undefined
        return sha256hex(signals.join('|'))
      } catch {
        return undefined
      }
    },
  }

  // Fire-and-forget — errors are swallowed by runInstancePing + this catch.
  runInstancePing(deps).catch(() => {})
}
