import { useLocation, useNavigate } from '@tanstack/react-router'

import { DemoUnavailableBanner } from './demo-unavailable-banner'
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
 * Not an auth wall: the backend is the security boundary
 * (lib/feature-permissions/server.ts), and data calls surface their own auth
 * states. It only redirects zero-host visitors to `/setup` and blocks the cloud
 * demo leak described in first-run-decision.ts.
 */
export function FirstRunGate({ children }: { children: React.ReactNode }) {
  const { hosts, isLoading, isUnauthorized, cloudMode, isSignedIn } =
    useMergedHosts()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const searchParams = useUrlSearchParams()
  const hostId = useHostId()

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

  // Both targets self-terminate into 'render'. Primitives keep the effect keyed
  // on intent, not `action`'s identity.
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

  if (action.type !== 'render') {
    return <PageSkeleton />
  }

  return (
    <>
      <DemoUnavailableBanner />
      {children}
    </>
  )
}
