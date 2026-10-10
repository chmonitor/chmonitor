/**
 * The auth provider ids. Import-free so build scripts
 * (`scripts/deploy-defaults.ts`) can share the type without importing the
 * resolver in `provider.ts`, which itself reads the mode matrix from there.
 */
export const AUTH_PROVIDERS = ['none', 'clerk', 'proxy', 'trusted'] as const

export type AuthProvider = (typeof AUTH_PROVIDERS)[number]
