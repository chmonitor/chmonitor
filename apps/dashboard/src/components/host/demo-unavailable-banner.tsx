import { CloudOff, RefreshCw } from 'lucide-react'

import { isDemoUnavailable } from './demo-unavailable'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useHostId } from '@/lib/swr'
import { useHostStatus } from '@/lib/swr/use-host-status'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

/** Presentational banner; kept separate from the hooks so it is testable. */
export function DemoUnavailableAlert({
  onRetry,
  retrying = false,
}: {
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <Alert data-testid="demo-unavailable-banner" className="mb-4">
      <CloudOff />
      <AlertTitle>Demo temporarily unavailable</AlertTitle>
      <AlertDescription>
        <p>
          The public demo cluster is not responding right now, so data below may
          be empty. This is not caused by your browser.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={onRetry}
          disabled={retrying}
          data-testid="demo-unavailable-retry"
        >
          <RefreshCw className={retrying ? 'animate-spin' : undefined} />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Banner shown above the routed page when the active host is the public cloud
 * demo and its host-status probe fails. Renders nothing otherwise, so
 * self-hosted behaviour is unchanged. Shares the host-status query key with the
 * host switcher, so this adds no extra request.
 */
export function DemoUnavailableBanner() {
  const hostId = useHostId()
  const { hosts } = useMergedHosts()
  const source = hosts.find((h) => h.id === hostId)?.source
  const { error, refetch, isFetching } = useHostStatus(
    source === 'demo' ? hostId : null
  )

  if (!isDemoUnavailable(source, error)) return null
  return (
    <DemoUnavailableAlert onRetry={() => refetch()} retrying={isFetching} />
  )
}
