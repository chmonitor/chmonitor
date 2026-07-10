/**
 * Server-side enforcement of the cloud demo-hiding invariant (#2172).
 *
 * `first-run-decision.ts` / `use-merged-hosts.ts` already hide the cloud demo
 * host from a signed-in visitor at the CLIENT render boundary: once signed in,
 * `?host=0` is never rendered against demo-backed charts. But that guarantee
 * is client-side only — the server data routes (`/api/v1/charts/$name`,
 * `/api/v1/tables/$name`, the two entry points `resolve-host-fetch.ts` calls
 * for env/demo hosts) still serve the demo to any caller who hand-crafts
 * `?hostId=0`.
 *
 * The discriminator is deterministic: user-connection hosts (browser/database)
 * always use NEGATIVE ids (`DB_CONNECTION_HOST_ID_START = -1000`, browser ids
 * count down from -1), while env/demo hosts use non-negative indices
 * `0, 1, 2, …`. So for an AUTHENTICATED cloud principal, a non-negative
 * `hostId` can only resolve to the hidden demo/env host and must be rejected.
 *
 * OSS (`cloudMode === false`) and anonymous cloud (`isSignedIn === false`) are
 * UNCHANGED — both legitimately use `hostId=0` (env hosts / the public demo).
 */

import { isClerkAuthProvider } from '@/lib/auth/provider'
import { isCloudModeServer } from '@/lib/cloud/cloud-mode'

/**
 * True when the current request carries an authenticated Clerk session.
 * Mirrors the client's `isSignedIn` semantics (useAuth()/useUser()) — always
 * false when Clerk isn't the configured auth provider. Never throws.
 */
export async function isSignedInServer(): Promise<boolean> {
  if (!isClerkAuthProvider()) return false

  try {
    // auth() in @clerk/tanstack-react-start@1.3.2 is no-request
    // (GetAuthFnNoRequest) — reads from the ambient request context.
    const { auth } = await import('@clerk/tanstack-react-start/server')
    const authResult = await auth()
    return Boolean(authResult?.userId)
  } catch {
    return false
  }
}

/**
 * Whether a `hostId` must be rejected for the current request under the
 * demo-hiding invariant: cloud mode, an authenticated caller, and a
 * non-negative id (only ever the hidden env/demo host — user connections are
 * always negative).
 */
export async function isDemoHostBlockedForRequest(
  hostId: number,
  bindings?: Record<string, string | undefined>
): Promise<boolean> {
  if (!isCloudModeServer(bindings)) return false
  if (hostId < 0) return false
  return isSignedInServer()
}

/**
 * Shared "demo hidden" payload for routes that reject a blocked hostId
 * (#2172 / #2488). Every guarded route embeds this under its own
 * `unavailable` field alongside a route-specific empty data shape — kept as
 * a shared constant so the reason code / message aren't duplicated per route.
 */
export function demoHiddenUnavailable(): {
  reason: 'demo_hidden'
  message: string
} {
  return {
    reason: 'demo_hidden',
    message: 'The demo host is hidden for signed-in accounts.',
  }
}
