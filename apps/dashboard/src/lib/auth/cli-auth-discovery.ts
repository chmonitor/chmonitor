/**
 * CLI auth auto-detection for `chm auth login`.
 *
 * Public discovery at `GET /api/v1/auth/cli` — the CLI probes this once and
 * branches without any `auth_mode` in chm.toml:
 *
 *   - `none`    — auth=none and no `CHM_API_KEY_SECRET` (API is open)
 *   - `device`  — device login enabled (`resolveDeviceLogin().enabled`)
 *   - `api_key` — API key required, device login off (typical self-hosted
 *                 without meta DB / without `CHM_DEVICE_LOGIN=true`)
 */

import { apiKeyAuthEnabled } from '@chm/mcp-server/auth'
import {
  type DeviceLoginStatus,
  resolveDeviceLogin,
} from '@/lib/auth/device-login-config'
import { type AuthProvider, parseAuthProvider } from '@/lib/auth/provider'

export type CliAuthMethod = 'none' | 'device' | 'api_key'
export type CliApiAccess = 'open' | 'key_required'

export interface CliAuthDiscovery {
  /** Whether anonymous `/api/v1/*` calls need a `chm_` key. */
  api: CliApiAccess
  authProvider: AuthProvider
  deviceLogin: DeviceLoginStatus
  /** Recommended login path for `chm auth login`. */
  method: CliAuthMethod
  /** One-line operator / CLI hint. */
  hint: string
}

function resolveAuthProvider(
  source: Record<string, string | undefined>
): AuthProvider {
  try {
    const authRaw =
      source.CHM_AUTH_PROVIDER ??
      source.VITE_AUTH_PROVIDER ??
      (typeof import.meta !== 'undefined'
        ? import.meta.env?.VITE_AUTH_PROVIDER
        : undefined)
    if (authRaw) {
      return parseAuthProvider(authRaw)
    }
    const profile = (
      source.CHM_DEPLOYMENT_MODE ??
      source.VITE_DEPLOYMENT_MODE ??
      ''
    )
      .trim()
      .toLowerCase()
    return profile === 'cloud' || profile === 'saas' ? 'clerk' : 'none'
  } catch {
    return 'none'
  }
}

function hintFor(
  method: CliAuthMethod,
  deviceLogin: DeviceLoginStatus
): string {
  switch (method) {
    case 'none':
      return 'Dashboard API is open (auth=none, no API key). No login needed.'
    case 'device':
      return deviceLogin.deviceOnly
        ? 'Device login enabled (device-only). Open /device to approve.'
        : 'Device login enabled. Sign in via browser device flow.'
    case 'api_key':
      return 'API key required. Pass --api-key / CHM_API_KEY, or mint one with POST /api/v1/auth/api-key.'
    default: {
      const _exhaustive: never = method
      return _exhaustive
    }
  }
}

/**
 * Resolve how the CLI should authenticate against this dashboard.
 * Pure w.r.t. env bag (same pattern as `resolveDeviceLogin`).
 */
export function resolveCliAuthDiscovery(
  runtimeEnv?: Record<string, string | undefined>
): CliAuthDiscovery {
  const source =
    runtimeEnv ??
    (typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>)
      : {})

  const deviceLogin = resolveDeviceLogin(runtimeEnv)
  const authProvider = resolveAuthProvider(source)

  // Prefer apiKeyAuthEnabled when using live process.env; for mock bags check
  // the bag directly so unit tests don't need to mutate process.env first.
  const keyRequired = runtimeEnv
    ? Boolean(runtimeEnv.CHM_API_KEY_SECRET?.trim())
    : apiKeyAuthEnabled()

  let method: CliAuthMethod
  if (deviceLogin.enabled) {
    method = 'device'
  } else if (keyRequired) {
    method = 'api_key'
  } else {
    method = 'none'
  }

  return {
    api: keyRequired ? 'key_required' : 'open',
    authProvider,
    deviceLogin,
    method,
    hint: hintFor(method, deviceLogin),
  }
}
