// Server reads the runtime worker var CHM_AUTH_PROVIDER first, then the runtime
// deployment-mode default, then the build-time client constant
// VITE_AUTH_PROVIDER (import.meta.env). See getAuthProvider().
import {
  modeDefaults,
  parseDeploymentMode,
} from '../../../scripts/deploy-defaults'

export const AUTH_PROVIDER_ENV_VARS = [
  'CHM_AUTH_PROVIDER',
  'VITE_AUTH_PROVIDER',
] as const

import { AUTH_PROVIDERS, type AuthProvider } from './auth-providers'

export { AUTH_PROVIDERS, type AuthProvider }

export class AuthProviderConfigError extends Error {
  constructor(value: string) {
    super(
      `Invalid auth provider value "${value}" in ${AUTH_PROVIDER_ENV_VARS.join(
        ' or '
      )}. Expected one of: none, clerk, proxy, trusted.`
    )
    this.name = 'AuthProviderConfigError'
  }
}

export function parseAuthProvider(
  value: string | null | undefined
): AuthProvider {
  const normalized = value?.trim().toLowerCase()

  if (!normalized || normalized === 'none') {
    return 'none'
  }

  if (normalized === 'clerk') {
    return 'clerk'
  }

  if (normalized === 'proxy') {
    return 'proxy'
  }

  if (normalized === 'trusted') {
    return 'trusted'
  }

  throw new AuthProviderConfigError(value ?? '')
}

type EnvGetter = (key: string) => string | undefined

function processEnvGetter(key: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[key] : undefined
}

/**
 * The ONE server-side auth-provider resolver. Every server reader calls this.
 *
 * Precedence (first non-empty wins):
 *   1. runtime `CHM_AUTH_PROVIDER`
 *   2. build-time `VITE_AUTH_PROVIDER` (baked only when explicitly set)
 *   3. runtime `CHM_DEPLOYMENT_MODE` → its mode default (cloud → clerk, oss → none)
 *   4. build-time `VITE_DEPLOYMENT_MODE` → its mode default
 * An explicitly baked provider beats a runtime mode, so a build made with
 * clerk can never be lowered to `none` by setting `CHM_DEPLOYMENT_MODE=oss`
 * (the client would still show sign-in while every API route ran open).
 * The published image bakes no provider, so a prebuilt image run with only
 * `CHM_DEPLOYMENT_MODE=cloud` still gets clerk.
 *
 * `getEnv` defaults to `process.env`; pass a Worker-binding reader on the edge.
 * Throws AuthProviderConfigError on an unrecognised explicit value.
 * (The mode matrix is imported from scripts/deploy-defaults, not
 * lib/config/deployment-mode, to stay import-cycle-free.)
 */
export function getAuthProvider(
  getEnv: EnvGetter = processEnvGetter
): AuthProvider {
  const runtime = getEnv('CHM_AUTH_PROVIDER')
  if (runtime) return parseAuthProvider(runtime)
  const baked = import.meta.env.VITE_AUTH_PROVIDER
  if (baked) return parseAuthProvider(baked)
  const runtimeMode = getEnv('CHM_DEPLOYMENT_MODE')
  if (runtimeMode) {
    return modeDefaults(parseDeploymentMode(runtimeMode)).authProvider
  }
  return getBuildAuthProvider()
}

/**
 * The auth provider baked into the build: `VITE_AUTH_PROVIDER` when set,
 * otherwise the default of the baked `VITE_DEPLOYMENT_MODE`. Client-safe.
 */
export function getBuildAuthProvider(): AuthProvider {
  const baked = import.meta.env.VITE_AUTH_PROVIDER
  if (baked) return parseAuthProvider(baked)
  return modeDefaults(parseDeploymentMode(import.meta.env.VITE_DEPLOYMENT_MODE))
    .authProvider
}

export function isClerkAuthProvider(): boolean {
  return getAuthProvider() === 'clerk'
}

export function isAuthProviderConfigError(
  error: unknown
): error is AuthProviderConfigError {
  return error instanceof AuthProviderConfigError
}
