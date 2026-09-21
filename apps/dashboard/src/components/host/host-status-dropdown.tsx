/**
 * Host status indicator for dropdown menu items
 *
 * Shows online/offline status as a colored dot indicator.
 * Shows checking effect while loading status.
 */

import { StatusIndicator } from './shared/status-indicator'
import { useHostStatus } from '@/lib/swr/use-host-status'

interface HostStatusDropdownProps {
  hostId: number
}

export const HostStatusDropdown = function HostStatusDropdown({
  hostId,
}: HostStatusDropdownProps) {
  const { isOnline, isLoading } = useHostStatus(hostId, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  })

  if (isLoading) {
    return (
      <StatusIndicator
        label="Checking"
        className="bg-gray-400 animate-pulse"
        title={['Checking...']}
      />
    )
  }

  if (isOnline) {
    return (
      <StatusIndicator
        label="Online"
        className="bg-emerald-500"
        title={['Online']}
      />
    )
  }

  return <StatusIndicator label="Offline" title={['Offline']} />
}
