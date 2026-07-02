/**
 * Pure decision logic for {@link FirstRunGate}, extracted so the cloud-mode
 * host-resolution invariant can be unit-tested without a React/router harness.
 *
 * ## Why this exists (the bug it fixes)
 *
 * In cloud (SaaS) mode the env `CLICKHOUSE_HOST` surfaces as a public read-only
 * `demo`. Once a user signs in, {@link useMergedHosts} HIDES that demo so their
 * workspace starts empty. But the active host for data fetching comes from the
 * `?host=` search param (default `0`) via `useHostId()`, which is decoupled from
 * the visible host list. A stale `?host=0` — carried over from browsing the demo
 * while anonymous — then points at the now-hidden demo.
 *
 * `resolve-host-fetch.ts` treats a host id that is NOT in the merged list as
 * "server host" and falls back to `/api/v1/charts/...?hostId=0`, which serves the
 * demo. So a signed-in, zero-connection user could still see real demo data,
 * violating the documented invariant (demo hidden → own connections only → zero
 * ⇒ welcome/setup). See docs/knowledge/cloud-saas-mode.md.
 *
 * The discriminator is deterministic: user connections (browser/database) always
 * use NEGATIVE host ids (`DB_CONNECTION_HOST_ID_START = -1000`, browser ids count
 * down from -1), while env/demo hosts use non-negative indices `0, 1, 2, …`. So a
 * non-negative `?host` for a signed-in cloud user can only ever be the hidden
 * demo — never one of their own hosts. We key off "is the resolved host actually
 * visible" rather than the raw id, which stays correct for every source.
 */

/** What FirstRunGate should do this render. */
export type FirstRunAction =
  /** Render the routed page. */
  | { type: 'render' }
  /** Render a skeleton and do not navigate (hosts still resolving). */
  | { type: 'wait' }
  /** Navigate to the /setup welcome surface, render a skeleton meanwhile. */
  | { type: 'setup' }
  /**
   * Re-point `?host` at a real, visible host id (the current selection is a
   * stale demo pointer) and render a skeleton meanwhile.
   */
  | { type: 'repoint'; hostId: number }

export interface FirstRunInput {
  /** Merged host list is still loading (env + browser + database). */
  isLoading: boolean
  /** The env-host fetch returned 401/403 (an auth failure, not a real empty). */
  isUnauthorized: boolean
  /** Current path is exempt (/setup, /billing, /organization). */
  onExemptPath: boolean
  /** Number of VISIBLE merged hosts. */
  hostCount: number
  /** Cloud (SaaS) mode is active for this deployment. */
  cloudMode: boolean
  /** Visitor is signed in (always false outside Clerk builds). */
  isSignedIn: boolean
  /** Whether the active `?host` id resolves to a currently-VISIBLE host. */
  hasVisibleResolvedHost: boolean
  /** First visible host id, if any (used to re-point a stale selection). */
  firstVisibleHostId: number | null
}

/**
 * Decide what FirstRunGate renders / navigates to.
 *
 * OSS and anonymous-cloud behaviour is unchanged: the only new branch is
 * "cloud + signed-in + the active host is not one of the user's visible hosts",
 * which must never fall through to rendering demo-backed charts.
 */
export function resolveFirstRunAction(input: FirstRunInput): FirstRunAction {
  const {
    isLoading,
    isUnauthorized,
    onExemptPath,
    hostCount,
    cloudMode,
    isSignedIn,
    hasVisibleResolvedHost,
    firstVisibleHostId,
  } = input

  // The frontend is a rendering layer, not the security boundary: a 401/403 is
  // not something the visitor resolves here, so we don't wall the app — pages
  // render and individual data calls surface their own states. (Unchanged.)
  if (isUnauthorized) return { type: 'render' }

  // Account/billing/setup pages stay reachable with zero hosts and must not be
  // re-pointed. (Unchanged.)
  if (onExemptPath) return { type: 'render' }

  // Cloud + signed-in: the env host is a hidden read-only demo. If the active
  // `?host` does not resolve to one of the user's OWN visible hosts, rendering
  // the routed page would leak demo data (resolve-host-fetch falls back to the
  // server/demo host for an unresolved id). Guard BEFORE we ever render charts,
  // and independently of whether their connections have finished loading.
  const cloudDemoLeakRisk = cloudMode && isSignedIn && !hasVisibleResolvedHost
  if (cloudDemoLeakRisk) {
    // Wait for their own connections rather than briefly flashing demo charts.
    if (isLoading) return { type: 'wait' }
    // Genuinely empty workspace → welcome/setup.
    if (hostCount === 0 || firstVisibleHostId === null) return { type: 'setup' }
    // They have their own host(s), but `?host` is a stale demo pointer — send
    // them to a real host instead of leaking the demo.
    return { type: 'repoint', hostId: firstVisibleHostId }
  }

  // Genuine first run for OSS / anonymous cloud: no hosts at all once resolved.
  // (While still loading we render children so existing skeletons/Suspense show.)
  if (!isLoading && hostCount === 0) return { type: 'setup' }

  return { type: 'render' }
}
