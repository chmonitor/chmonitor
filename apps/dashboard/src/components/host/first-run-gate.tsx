import { useLocation, useNavigate } from '@tanstack/react-router'

import {
  isFirstRunExemptPath,
  resolveFirstRunAction,
} from './first-run-decision'
import { useEffect } from 'react'
import { PageSkeleton } from '@/components/skeletons'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { useHostId } from '@/lib/swr'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'
import { buildUrl, splitHref } from '@/lib/url/url-builder'
import { keepHostSearch } from '@/routes/-root-search'

/**
 * The frontend is a pure rendering layer; the backend is the security boundary
 * (see lib/feature-permissions/server.ts). So this gate no longer walls the whole
 * app behind an "Authentication required" screen on a 401/403 — that is not
 * something the visitor can resolve here, in `none` mode there is no sign-in at
 * all, and the workerd server can't tell an authenticated principal apart anyway.
 * Pages render; individual data calls surface their own auth / empty / error
 * states (and in `none` mode the API allows everything, so they just succeed).
 *
 * Two first-run surfaces are kept:
 *
 *  1. Zero ClickHouse hosts configured (genuine onboarding) — send the visitor to
 *     the stable `/setup` URL (which renders FirstRunEmptyState) rather than
 *     showing the empty state inline. `/setup` is itself wrapped by this gate, so
 *     it renders children there instead of redirecting — no loop.
 *  2. Cloud (SaaS) + signed-in, where the env host is a HIDDEN read-only demo. A
 *     stale `?host=0` (carried over from browsing the demo while anonymous) points
 *     at that hidden demo, and resolve-host-fetch would fall back to the server
 *     (demo) host for the unresolved id — leaking demo data into a signed-in
 *     user's workspace. We refuse to render the routed page until the active
 *     `?host` resolves to one of their OWN visible hosts: with none we go to
 *     `/setup`; with some we re-point `?host` at a real host. See
 *     first-run-decision.ts and docs/knowledge/cloud-saas-mode.md.
 *
 * While hosts are still loading (outside the cloud demo-leak case) we render
 * children so existing skeletons / Suspense fallbacks keep showing.
 *
 * NOTE: `FirstRunUnauthorizedState` is intentionally no longer rendered here. The
 * component is kept for a possible future inline sign-in prompt rather than a
 * full-page wall.
 */
export function FirstRunGate({ children }: { children: React.ReactNode }) {
  const { hosts, isLoading, isUnauthorized, cloudMode, isSignedIn } =
    useMergedHosts()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const searchParams = useUrlSearchParams()
  const hostId = useHostId()

  // Account/billing/about pages stay reachable with zero hosts (a paying user
  // with no host yet must manage plan/org; About is a static info page). /setup
  // is itself exempt — no redirect loop, it renders the onboarding surface. See
  // FIRST_RUN_EXEMPT_PATHS in first-run-decision.ts.
  const onExemptPath = isFirstRunExemptPath(pathname)

  const action = resolveFirstRunAction({
    isLoading,
    isUnauthorized: Boolean(isUnauthorized),
    onExemptPath,
    hostCount: hosts.length,
    cloudMode,
    isSignedIn,
    hasVisibleResolvedHost: hosts.some((h) => h.id === hostId),
    firstVisibleHostId: hosts[0]?.id ?? null,
  })

  // Drive the one navigation each action implies. Both targets self-terminate:
  // reaching /setup makes the path exempt (→ 'render'); a re-point changes the
  // resolved host so it becomes visible (→ 'render'). Read only primitives here
  // so the effect is keyed on the resolved intent, not `action`'s identity.
  const goSetup = action.type === 'setup'
  const repointHostId = action.type === 'repoint' ? action.hostId : null
  useEffect(() => {
    if (goSetup) {
      navigate({ to: '/setup', search: keepHostSearch, replace: true })
    } else if (repointHostId !== null) {
      navigate({
        ...splitHref(buildUrl(pathname, { host: repointHostId }, searchParams)),
        replace: true,
      })
    }
  }, [goSetup, repointHostId, pathname, searchParams, navigate])

  // Render a skeleton (never the routed page's demo-backed charts) whenever we
  // are waiting on host resolution or a pending navigation.
  if (action.type !== 'render') {
    return <PageSkeleton />
  }

  return <>{children}</>
}
