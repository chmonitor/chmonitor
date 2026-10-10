// Deployment-mode default matrix — the SINGLE source of truth shared by the
// runtime resolver (src/lib/config/deployment-mode.ts) and the deploy-time
// build script (scripts/patch-wrangler-env.ts).
//
// Why a separate, NON-ALIASED module: the build script runs with `bun` before
// the vite build and imports plain relative paths, while the runtime module is
// consumed from `@/`-aliased source. Keeping the matrix here — with only a
// type-only import (erased at runtime) — lets BOTH sides derive from ONE copy,
// so a cloud/oss default can never silently diverge between them (a divergence
// would flip the cloud read-only posture; see #2067 / #2055).
//
// ►► To change what a mode defaults to, edit MODE_DEFAULTS below — nowhere else. ◄◄

import type { AuthProvider } from '../src/lib/auth/auth-providers'

export const DEPLOYMENT_MODES = ['oss', 'cloud'] as const
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number]

/**
 * Parse a raw env string into a deployment mode. `cloud` / `saas` select cloud;
 * `oss` / `self-hosted` / anything else → oss (fail-closed). Never throws.
 */
export function parseDeploymentMode(
  value: string | null | undefined
): DeploymentMode {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'cloud' || normalized === 'saas') return 'cloud'
  return 'oss'
}

/**
 * The set of defaults a deployment mode resolves to — the "good defaults from
 * the beginning". A mode alone yields a correct, coherent deployment.
 */
export interface ModeDefaults {
  /** Public read-only demo hosts for anon + blank workspace when signed in. */
  cloudMode: boolean
  /** Default auth posture (overridable with CHM_AUTH_PROVIDER). */
  authProvider: AuthProvider
  /** Anonymous visitors may read (but not write) without signing in. */
  clerkPublicRead: boolean
  /** Per-user ClickHouse connection storage (D1/Postgres). */
  userConnectionsDb: boolean
  /** Server-side agent conversation persistence. */
  conversationDb: boolean
  /**
   * Allow connecting to private / LAN / loopback / Tailscale (CGNAT) ClickHouse
   * hosts through the connection form. Self-host only — FORCED off in cloud mode
   * (multi-tenant SSRF safety), regardless of the explicit flag.
   */
  allowPrivateHosts: boolean
}

/**
 * SINGLE SOURCE OF TRUTH for per-mode defaults. Every reader (vite client build
 * + server via resolveConfig(), and the deploy build script via modeDefaultVars())
 * derives from this map.
 */
export const MODE_DEFAULTS: Record<DeploymentMode, ModeDefaults> = {
  oss: {
    cloudMode: false,
    authProvider: 'none',
    clerkPublicRead: false,
    userConnectionsDb: false,
    conversationDb: false,
    allowPrivateHosts: false,
  },
  cloud: {
    cloudMode: true,
    authProvider: 'clerk',
    clerkPublicRead: true,
    userConnectionsDb: true,
    conversationDb: true,
    allowPrivateHosts: false,
  },
}

export function modeDefaults(mode: DeploymentMode): ModeDefaults {
  return MODE_DEFAULTS[mode]
}

/**
 * Project the mode defaults into the CONCRETE worker `[vars]` the deploy script
 * injects, so the worker never depends on per-request runtime derivation (a
 * missing/mismatched runtime read would silently drop the cloud public-read
 * posture → anon 401). Only the "on" defaults are emitted — falsy/`none`
 * defaults are omitted so an oss deploy adds no vars and the `.env` file stays
 * authoritative. Derived from MODE_DEFAULTS, so values can never drift from the
 * runtime resolver.
 */
export function modeDefaultVars(mode: DeploymentMode): Record<string, string> {
  const d = MODE_DEFAULTS[mode]
  const vars: Record<string, string> = {}
  if (d.cloudMode) vars.CHM_CLOUD_MODE = 'true'
  if (d.authProvider !== 'none') vars.CHM_AUTH_PROVIDER = d.authProvider
  if (d.clerkPublicRead) vars.CHM_CLERK_PUBLIC_READ = 'true'
  if (d.userConnectionsDb) vars.CHM_FEATURE_USER_CONNECTIONS_DB = 'true'
  if (d.conversationDb) vars.CHM_FEATURE_CONVERSATION_DB = 'true'
  return vars
}
