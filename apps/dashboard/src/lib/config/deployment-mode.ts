// Deployment mode — the ONE high-level switch that picks good defaults.
//
// Goal: an operator configures a working deployment with a single var
// (`CHM_DEPLOYMENT_MODE`) plus the auth-specific secrets, instead of hand-setting
// the 8+ overlapping mode/auth/feature flags. Every individual flag still exists
// as an OVERRIDE, but with a sane per-mode default it rarely needs to be set.
//
//   oss (default)                cloud (dash.chmonitor.dev)
//   ──────────────────────────   ─────────────────────────────────────────────
//   operator's real CLICKHOUSE   env hosts are a PUBLIC READ-ONLY DEMO
//   hosts, full access           (e.g. `duet-ubuntu`) owned by the ANON visitor
//   auth: none (or clerk/        auth: clerk; anonymous = full read-only demo,
//         trusted if set)        signed-in = blank workspace they populate
//   no per-user storage          per-user (D1) ClickHouse connections on
//
// Design invariant (mirrors lib/cloud, lib/edition): FAIL-CLOSED to oss. An
// unset / empty / unrecognised CHM_DEPLOYMENT_MODE resolves to oss, so the
// open-source build is never degraded and cloud behaviour is strictly opt-in.
//
// ►► To change what a mode defaults to, edit ONE place: MODE_DEFAULTS in
//    ../../../scripts/deploy-defaults.ts — the single matrix shared with the
//    deploy build script (scripts/patch-wrangler-env.ts). ◄◄

import { parseAuthProvider } from '@/lib/auth/provider'
import { parseBool, parseCloudModeFlag } from '@/lib/config/parse-bool'

// The mode-default matrix lives in a plain, non-aliased module so the deploy
// build script (which runs before the vite build and can't use `@/` imports)
// derives from the SAME copy. Re-exported here to preserve this module's public
// API for existing `@/lib/config/deployment-mode` importers.
export {
  DEPLOYMENT_MODES,
  type DeploymentMode,
  MODE_DEFAULTS,
  type ModeDefaults,
  modeDefaults,
  parseDeploymentMode,
} from '../../../scripts/deploy-defaults'

import {
  type DeploymentMode,
  type ModeDefaults,
  modeDefaults,
  parseDeploymentMode,
} from '../../../scripts/deploy-defaults'

// ---------------------------------------------------------------------------
// Resolution: per-mode default, then explicit-var override.
// ---------------------------------------------------------------------------

type EnvGetter = (key: string) => string | undefined

export interface ResolvedConfig extends ModeDefaults {
  mode: DeploymentMode
}

/**
 * Resolve the effective config from the deployment mode plus explicit overrides.
 * Each explicit var (when set) wins over the mode default; otherwise the default
 * applies. Pure — pass any env getter (worker binding, process.env, a mock).
 */
export function resolveConfig(getEnv: EnvGetter): ResolvedConfig {
  const mode = parseDeploymentMode(getEnv('CHM_DEPLOYMENT_MODE'))
  const d = modeDefaults(mode)

  const cloudMode = parseCloudModeFlag(getEnv('CHM_CLOUD_MODE')) ?? d.cloudMode
  const authRaw = getEnv('CHM_AUTH_PROVIDER')
  const authProvider = authRaw ? parseAuthProvider(authRaw) : d.authProvider
  const clerkPublicRead =
    parseBool(getEnv('CHM_CLERK_PUBLIC_READ')) ?? d.clerkPublicRead
  const userConnectionsDb =
    parseBool(getEnv('CHM_FEATURE_USER_CONNECTIONS_DB')) ?? d.userConnectionsDb
  const conversationDb =
    parseBool(getEnv('CHM_FEATURE_CONVERSATION_DB')) ?? d.conversationDb
  // Fail-closed: cloud ALWAYS blocks private hosts, the flag can't override it.
  const allowPrivateHosts =
    !cloudMode &&
    (parseBool(getEnv('CHM_ALLOW_PRIVATE_HOSTS')) ?? d.allowPrivateHosts)

  return {
    mode,
    cloudMode,
    authProvider,
    clerkPublicRead,
    userConnectionsDb,
    conversationDb,
    allowPrivateHosts,
  }
}
