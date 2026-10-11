// The ONE resolver for whether the agent gets the destructive control tools
// (kill_query, optimize_table, kill_mutation). The agent route calls it per
// request and passes the result to createAllTools() as `includeControlTools`.
//
// Default: ON for self-hosted, OFF in cloud.
//   - self-hosted: on when nobody can be anonymous (auth `none`, `trusted`,
//     `proxy`) or when a Clerk caller is signed in; off for a Clerk anonymous
//     (public-read) visitor.
//   - cloud: off.
// An explicit AGENT_ENABLE_CONTROL_TOOLS (parseBool grammar) always wins, with
// one fixed exception: an anonymous cloud visitor never gets write tools.
//
// This only decides the default. The route still runs the `actions` feature
// permission check (CHM_DISABLED_FEATURES, auth-required), and tools bound to
// a user's own connection still refuse writes (CONNECTION_UNSUPPORTED_TOOLS).

import type { AuthProvider } from '@/lib/auth/provider'

import { parseBool } from '@/lib/config/parse-bool'

export interface ControlToolsGateInput {
  /** Raw AGENT_ENABLE_CONTROL_TOOLS value. */
  flag: string | null | undefined
  /** Cloud (SaaS) mode, from isCloudModeServer(). */
  cloud: boolean
  authProvider: AuthProvider
  /** The caller has a signed-in identity (not `guest`). */
  signedIn: boolean
}

export function resolveControlToolsEnabled({
  flag,
  cloud,
  authProvider,
  signedIn,
}: ControlToolsGateInput): boolean {
  // Fail closed: no flag value can hand write tools to an anonymous cloud visitor.
  if (cloud && !signedIn) return false

  const explicit = parseBool(flag)
  if (explicit !== undefined) return explicit

  if (cloud) return false
  return authProvider !== 'clerk' || signedIn
}
