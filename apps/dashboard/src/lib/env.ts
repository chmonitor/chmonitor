// Isomorphic env bridge for the TanStack Start app.
//
//   - Client-exposed vars are VITE_-prefixed and read from import.meta.env
//     (typed in src/vite-env.d.ts).
//   - Server vars are read from the runtime env: process.env on node, or the
//     Cloudflare Worker binding passed in on the edge.
//
// Auth-provider resolution is NOT reimplemented here — it delegates to the one
// resolver in lib/auth/provider.ts so every reader agrees.

import {
  type AuthProvider,
  getAuthProvider,
  getBuildAuthProvider,
} from '@/lib/auth/provider'

export {
  type AuthProvider,
  AuthProviderConfigError,
  parseAuthProvider,
} from '@/lib/auth/provider'

// Client-safe: the provider baked into the bundle (VITE_AUTH_PROVIDER, else the
// baked VITE_DEPLOYMENT_MODE default).
export function getClientAuthProvider(): AuthProvider {
  return getBuildAuthProvider()
}

// Server-side: see getAuthProvider() for precedence. Pass the Cloudflare `env`
// binding on the edge; defaults to process.env on node.
export function getServerAuthProvider(
  runtimeEnv?: Record<string, string | undefined>
): AuthProvider {
  const source =
    runtimeEnv ?? (typeof process !== 'undefined' ? process.env : {})
  return getAuthProvider((key) => source[key])
}

export function isClerkEnabled(
  runtimeEnv?: Record<string, string | undefined>
): boolean {
  return getServerAuthProvider(runtimeEnv) === 'clerk'
}
