/**
 * Device-login (RFC 8628) enablement for `chm auth login`.
 *
 * `CHM_DEVICE_LOGIN`:
 *   - `auto` (default) — on in cloud when `CHM_API_KEY_SECRET` is set; **off**
 *     for self-hosted/OSS (internal networks usually mint a key once or leave
 *     the API open).
 *   - `true`  — force on (self-hosted opt-in; works with auth=none as
 *     device-only approve, trusting network reachability of `/device`).
 *   - `false` — force off everywhere.
 *
 * Prerequisites when enabled: `CHM_API_KEY_SECRET` (to mint `chm_` tokens).
 * Persistence: D1 when bound, otherwise an in-memory store (single-node).
 */

import { apiKeyAuthEnabled } from '@chm/mcp-server/auth'
import { parseAuthProvider } from '@/lib/auth/provider'
import { isCloudModeServer } from '@/lib/cloud/cloud-mode'

export type DeviceLoginMode = 'auto' | 'true' | 'false'

export type DeviceLoginDisabledReason =
  | 'disabled'
  | 'missing_api_key_secret'
  | null

export type DeviceCodeStoreKind = 'd1' | 'memory' | 'none'

export interface DeviceLoginStatus {
  mode: DeviceLoginMode
  /** Whether `/api/v1/auth/device/*` should accept new flows. */
  enabled: boolean
  /**
   * Approve without Clerk/proxy identity — `CHM_AUTH_PROVIDER=none` and
   * device login enabled. Trust: anyone who can reach `/device`.
   */
  deviceOnly: boolean
  reason: DeviceLoginDisabledReason
  /** Subject embedded in minted `chm_` keys for device-only approve. */
  subject: string
  store: DeviceCodeStoreKind
}

const DEFAULT_SUBJECT = 'self-hosted'

/**
 * Parse `CHM_DEVICE_LOGIN`. Unset / empty / junk / `auto` → `auto`
 * (fail-closed for OSS via resolve, not via parse).
 */
export function parseDeviceLoginMode(
  value: string | null | undefined
): DeviceLoginMode {
  const normalized = value?.trim().toLowerCase()
  if (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes' ||
    normalized === 'on'
  ) {
    return 'true'
  }
  if (
    normalized === 'false' ||
    normalized === '0' ||
    normalized === 'no' ||
    normalized === 'off'
  ) {
    return 'false'
  }
  return 'auto'
}

function readSubject(source: Record<string, string | undefined>): string {
  const raw = source.CHM_DEVICE_LOGIN_SUBJECT?.trim()
  return raw && raw.length > 0 ? raw : DEFAULT_SUBJECT
}

function hasD1Hint(source: Record<string, string | undefined>): boolean {
  // Best-effort for status/docs: Workers bind D1 as an object, not an env
  // string. Unit tests and some deploys set CHM_CLOUD_D1 as a non-empty
  // sentinel. The live store still probes the real binding in
  // device-code-store.ts.
  const sentinel = source.CHM_CLOUD_D1
  return sentinel != null && sentinel !== ''
}

/**
 * Resolve whether device login is on and how approve should behave.
 * Pure w.r.t. mode/cloud/secret; store kind is best-effort.
 */
export function resolveDeviceLogin(
  runtimeEnv?: Record<string, string | undefined>
): DeviceLoginStatus {
  const source =
    runtimeEnv ??
    (typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>)
      : {})

  const mode = parseDeviceLoginMode(source.CHM_DEVICE_LOGIN)
  const cloud = isCloudModeServer(source)
  const subject = readSubject(source)
  const d1 = hasD1Hint(source)
  const storeWhenOn: DeviceCodeStoreKind = d1 ? 'd1' : 'memory'

  // Wanted by mode: auto follows cloud; true/false are explicit.
  const wanted = mode === 'true' ? true : mode === 'false' ? false : cloud

  let authProvider: ReturnType<typeof parseAuthProvider> = 'none'
  try {
    const authRaw =
      source.CHM_AUTH_PROVIDER ??
      source.VITE_AUTH_PROVIDER ??
      (typeof import.meta !== 'undefined'
        ? import.meta.env?.VITE_AUTH_PROVIDER
        : undefined)
    if (authRaw) {
      authProvider = parseAuthProvider(authRaw)
    } else {
      const profile = (
        source.CHM_DEPLOYMENT_MODE ??
        source.VITE_DEPLOYMENT_MODE ??
        ''
      )
        .trim()
        .toLowerCase()
      authProvider =
        profile === 'cloud' || profile === 'saas' ? 'clerk' : 'none'
    }
  } catch {
    authProvider = 'none'
  }

  if (!wanted) {
    return {
      mode,
      enabled: false,
      deviceOnly: false,
      reason: 'disabled',
      subject,
      store: 'none',
    }
  }

  // Prefer apiKeyAuthEnabled when using live process.env; for mock bags check
  // the bag directly so unit tests don't need to mutate process.env first.
  const secretOk = runtimeEnv
    ? Boolean(runtimeEnv.CHM_API_KEY_SECRET?.trim())
    : apiKeyAuthEnabled()

  if (!secretOk) {
    return {
      mode,
      enabled: false,
      deviceOnly: false,
      reason: 'missing_api_key_secret',
      subject,
      store: storeWhenOn,
    }
  }

  const deviceOnly = authProvider === 'none'

  return {
    mode,
    enabled: true,
    deviceOnly,
    reason: null,
    subject,
    store: storeWhenOn,
  }
}

/** Convenience: whether new device codes / token polls should run. */
export function isDeviceLoginEnabled(
  runtimeEnv?: Record<string, string | undefined>
): boolean {
  return resolveDeviceLogin(runtimeEnv).enabled
}

/**
 * Subject to bind on approve when `deviceOnly` is true.
 * Ignored when a real identity provider session supplies the user id.
 */
export function getDeviceLoginSubject(
  runtimeEnv?: Record<string, string | undefined>
): string {
  return resolveDeviceLogin(runtimeEnv).subject
}
