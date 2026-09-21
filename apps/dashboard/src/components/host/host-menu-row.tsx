import { Check, ClockIcon, TagIcon } from 'lucide-react'

import { formatCompactUptime } from './format-uptime'
import { StatusIndicator } from './shared/status-indicator'
import { Skeleton } from '@/components/ui/skeleton'
import { useHostStatus } from '@/lib/swr/use-host-status'
import { cn } from '@/lib/utils'

interface HostMenuRowProps {
  hostId: number | null
  hostName: string
  isActive: boolean
  /** Skip live status polling (browser/database hosts). */
  skipStatus?: boolean
}

/**
 * Parse a full version string into a short v{major}.{minor} label.
 * e.g. "24.3.1.1" → "v24.3", "24.12.1.1234" → "v24.12"
 */
function formatShortVersion(version: string): string {
  const parts = version.split('.')
  if (parts.length >= 2) {
    return `v${parts[0]}.${parts[1]}`
  }
  return version
}

export const HostMenuRow = function HostMenuRow({
  hostId,
  hostName,
  isActive,
  skipStatus = false,
}: HostMenuRowProps) {
  const { data, isOnline, isLoading } = useHostStatus(
    skipStatus ? null : hostId,
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
    }
  )

  const dotClass = skipStatus
    ? 'bg-sky-500'
    : isLoading
      ? 'bg-gray-400 animate-pulse'
      : isOnline
        ? 'bg-emerald-500'
        : 'bg-red-400'

  const tooltip = skipStatus
    ? ['Custom connection']
    : isLoading
      ? ['Checking...']
      : isOnline && data
        ? [`Host: ${data.hostname}`, `Uptime: ${data.uptime}`]
        : ['Offline']

  const statusLabel = skipStatus
    ? 'Custom connection'
    : isLoading
      ? 'Checking'
      : isOnline
        ? 'Online'
        : 'Offline'

  return (
    <div className="flex w-full items-center gap-2.5">
      <StatusIndicator
        label={statusLabel}
        className={dotClass}
        title={tooltip}
      />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium">{hostName}</span>
        {skipStatus ? (
          <span className="truncate text-xs text-muted-foreground">
            Custom connection
          </span>
        ) : isLoading ? (
          <Skeleton className="mt-0.5 h-3 w-24" />
        ) : isOnline && data ? (
          <span
            className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground"
            title={`Version ${data.version} · Uptime ${data.uptime}`}
          >
            <TagIcon className="size-3 shrink-0 opacity-70" />
            {/* Version is short and the priority — never shrink it. */}
            <span className="shrink-0 tabular-nums">
              {formatShortVersion(data.version)}
            </span>

            {/* Show full version in dropdown (more space available) */}
            <span className="hidden @[240px]:inline text-muted-foreground/60">
              {data.version}
            </span>

            <span className="shrink-0 opacity-40">·</span>
            <ClockIcon className="size-3 shrink-0 opacity-70" />
            {/* Uptime yields first: it needs min-w-0 to ellipsize inside a flex row. */}
            <span className="min-w-0 truncate tabular-nums">
              {formatCompactUptime(data.uptime)}
            </span>
          </span>
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            Offline
          </span>
        )}
      </div>
      <Check
        className={cn(
          'ml-auto size-4 shrink-0 text-muted-foreground transition-opacity',
          isActive ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  )
}
