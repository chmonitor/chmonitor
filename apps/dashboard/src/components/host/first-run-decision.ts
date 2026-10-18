/**
 * In cloud mode a signed-in user's hosts hide the env demo, but a stale
 * `?host=0` from anonymous browsing still points at it, and resolve-host-fetch
 * falls back to the server (demo) host for an id not in the merged list. That
 * leaks demo data into their workspace. We key off "is the resolved host
 * visible" rather than the raw id. See docs/knowledge/cloud-saas-mode.md.
 */

/**
 * Reachable with zero hosts: `/setup` (exempt to avoid a redirect loop),
 * `/billing` (a paying user with no host must manage their plan), `/about`.
 */
export const FIRST_RUN_EXEMPT_PATHS = ['/setup', '/billing', '/about'] as const

/** Whether `pathname` is exempt from the first-run `/setup` redirect. */
export function isFirstRunExemptPath(pathname: string): boolean {
  return (FIRST_RUN_EXEMPT_PATHS as readonly string[]).includes(pathname)
}

/** What FirstRunGate should do this render. */
export type FirstRunAction =
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
  isLoading: boolean
  /** The env-host fetch returned 401/403 (an auth failure, not a real empty). */
  isUnauthorized: boolean
  onExemptPath: boolean
  hostCount: number
  cloudMode: boolean
  isSignedIn: boolean
  hasVisibleResolvedHost: boolean
  /** First visible host id, if any (used to re-point a stale selection). */
  firstVisibleHostId: number | null
}

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
  // render and individual data calls surface their own states.
  if (isUnauthorized) return { type: 'render' }

  // Account/billing/about/setup pages stay reachable with zero hosts and must
  // not be re-pointed.
  if (onExemptPath) return { type: 'render' }

  // Guard before rendering charts, even while connections are still loading.
  const cloudDemoLeakRisk = cloudMode && isSignedIn && !hasVisibleResolvedHost
  if (cloudDemoLeakRisk) {
    // Wait for their own connections rather than briefly flashing demo charts.
    if (isLoading) return { type: 'wait' }
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
