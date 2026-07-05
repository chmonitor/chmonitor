import { GlobeIcon, PlusIcon } from 'lucide-react'

import type { MergedHostInfo } from '@/lib/swr/use-merged-hosts'

import { StatusIndicator } from './shared'
import { useState } from 'react'
import { ConnectionManagerDialog } from '@/components/connections'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBrowserConnections } from '@/lib/hooks/use-browser-connections'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'
import { useHostStatus } from '@/lib/swr/use-host-status'
import { buildUrl } from '@/lib/url/url-builder'
import { getHost } from '@/lib/utils'

type ClickHouseHostSelectorProps = {
  currentHostId: number
  hosts: MergedHostInfo[]
}

/**
 * Host selector component for static routing with query parameters.
 * Handles host switching by updating the `host` query parameter.
 * Status indicators are shown in the dropdown for each host.
 */
export function ClickHouseHostSelector({
  currentHostId = 0,
  hosts,
}: ClickHouseHostSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)
  const { connections, addConnection, updateConnection, deleteConnection } =
    useBrowserConnections()

  const handleValueChange = (val: string) => {
    if (val === '__add_connection__') {
      setDialogOpen(true)
      return
    }
    const hostId = parseInt(val, 10)
    if (!Number.isNaN(hostId)) {
      const url = buildUrl(pathname, { host: hostId }, searchParams)
      router.push(url)
    }
  }

  // Find current host by id (works for both positive env hosts and negative browser hosts)
  const current = hosts.find((h) => h.id === currentHostId) ?? hosts[0]

  if (!current) {
    return null
  }

  return (
    <>
      <Select
        value={current.id.toString()}
        onValueChange={(val) => {
          if (val != null) handleValueChange(val)
        }}
      >
        <SelectTrigger
          className="w-auto border-0 p-1 shadow-none focus:ring-0"
          data-testid="host-selector"
          aria-label={`Select ClickHouse host. Current host: ${current.name || getHost(current.host)}`}
        >
          <SelectValue
            placeholder={current.name || getHost(current.host)}
            className="mr-2 w-fit truncate"
          />
        </SelectTrigger>
        <SelectContent data-testid="host-options">
          {hosts.map((host) => (
            <SelectItem
              key={host.host + host.id}
              value={host.id.toString()}
              data-testid={`host-option-${host.id}`}
            >
              <div className="flex items-center gap-2">
                {host.source === 'browser' && (
                  <GlobeIcon className="size-3 text-muted-foreground" />
                )}
                <HostStatusIndicator
                  hostId={host.id}
                  hostName={host.name || getHost(host.host)}
                />
              </div>
            </SelectItem>
          ))}
          <SelectItem
            value="__add_connection__"
            data-testid="add-connection"
            className="text-muted-foreground"
          >
            <div className="flex items-center gap-2">
              <PlusIcon className="size-3" />
              <span>Add connection</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      <ConnectionManagerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connections={connections}
        onAdd={addConnection}
        onUpdate={updateConnection}
        onDelete={deleteConnection}
      />
    </>
  )
}

/**
 * Host status indicator component using SWR for data fetching.
 * Displays online/offline status with tooltip showing host details.
 */
const HostStatusIndicator = function HostStatusIndicator({
  hostId,
  hostName,
}: {
  hostId: number
  hostName: string
}) {
  const { data, isOnline, isLoading } = useHostStatus(hostId, {
    refreshInterval: 60000,
    revalidateOnFocus: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <span>{hostName}</span>
        <StatusIndicator
          title={['Loading...']}
          className="bg-gray-400 animate-pulse"
        />
      </div>
    )
  }

  if (isOnline && data) {
    return (
      <div className="flex items-center gap-2">
        <span>{hostName}</span>
        <StatusIndicator
          className="bg-sky-500"
          title={[
            `Host: ${data.hostname}`,
            `Online: ${data.uptime}`,
            `Version: ${data.version}`,
          ]}
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span>{hostName}</span>
      <StatusIndicator title={['The host is offline']} />
    </div>
  )
}
