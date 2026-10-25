import { CloudOff, RefreshCw } from 'lucide-react'

import { isDemoUnavailable } from './demo-unavailable'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useHostId } from '@/lib/swr'
import { useHostStatus } from '@/lib/swr/use-host-status'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

/**
 * Presentational banner. It is `fixed` (an overlay), not in document flow: it
 * appears ~2s after load once host-status fails, so an in-flow banner shifted
 * every page down (CLS 0.18 on mobile). Reserving space instead would leave a
 * blank gap on every healthy load. Kept separate from the hooks so it is
 * testable.
 */
export function DemoUnavailableAlert({
  onRetry,
  retrying = false,
}: {
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <Alert
      data-testid="demo-unavailable-banner"
      className="fixed inset-x-4 bottom-20 z-40 w-auto shadow-lg sm:right-auto sm:bottom-4 sm:max-w-sm"
    >
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
          className="mt-2 pointer-coarse:h-11"
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

/** Shares the host-status query key with the host switcher, so it adds no request. */
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
