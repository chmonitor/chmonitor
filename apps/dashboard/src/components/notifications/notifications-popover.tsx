/**
 * Notifications Popover Component
 *
 * Displays notifications/alerts from the notifications API.
 * Shows a badge with count and a popover with the list of notifications.
 *
 * Features:
 * - Hidden when no notifications
 * - Badge shows total count
 * - Popover lists all notifications with links to details
 * - Dismiss individual or all notifications (saved to localStorage)
 * - Refresh button to manually refresh
 */

import {
  AlertTriangle,
  Bell,
  ExternalLink,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'

import { useState } from 'react'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useHostId } from '@/lib/swr/use-host'
import {
  type NotificationWithKey,
  useNotifications,
} from '@/lib/swr/use-notifications'
import { cn } from '@/lib/utils'

/**
 * NotificationsPopover - Shows notifications with badge and popover
 *
 * Displays a bell icon with notification count badge.
 * Click to see all notifications with dismiss and link actions.
 */
export const NotificationsPopover = function NotificationsPopover() {
  const [isOpen, setIsOpen] = useState(false)
  const hostId = useHostId()
  const { notifications, totalCount, isLoading, error, refresh, dismissAll } =
    useNotifications(hostId)

  // Don't render badge if no notifications and not loading
  if (!isLoading && !error && totalCount === 0) {
    return (
      <IconButton
        tooltip="Notifications"
        icon={<Bell className="size-4 text-muted-foreground" />}
        className="hidden sm:flex"
        disabled
      />
    )
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="relative hidden sm:flex">
        <IconButton
          tooltip="Notifications"
          icon={<Bell className="size-4" />}
          className="hidden sm:flex"
        />
        <div className="absolute -top-1 -right-1 size-4 rounded-full bg-muted animate-pulse" />
      </div>
    )
  }

  // Show error state (no badge, just icon)
  if (error) {
    return (
      <IconButton
        tooltip="Notifications (error loading)"
        icon={<Bell className="size-4 text-muted-foreground" />}
        className="hidden sm:flex"
        onClick={() => refresh()}
      />
    )
  }

  const handleDismissAll = () => {
    dismissAll()
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger render={<div className="relative hidden sm:flex" />}>
        <IconButton
          tooltip={`${totalCount} notification${totalCount === 1 ? '' : 's'}`}
          icon={<Bell className="size-4" />}
          className="hidden sm:flex"
        />
        {totalCount > 0 && (
          <Badge
            variant="secondary"
            className="absolute -top-0.5 -right-0.5 size-3.5 flex items-center justify-center p-0 text-[10px] font-medium tabular-nums"
          >
            {totalCount > 99 ? '99+' : totalCount}
          </Badge>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Bell className="size-3.5" />
            <h3 className="text-sm font-semibold">Notifications</h3>
            {totalCount > 0 && (
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[10px] tabular-nums"
              >
                {totalCount}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setIsOpen(false)}
            aria-label="Close notifications"
          >
            <X className="size-3.5" />
          </Button>
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
            <Bell className="size-6 text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground">No notifications</p>
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto">
            <div className="py-1">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.key}
                  notification={notification}
                />
              ))}
            </div>
          </div>
        )}

        {notifications.length > 0 && (
          <div className="flex items-center justify-between border-t px-2.5 py-2 bg-muted/30">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                refresh()
              }}
            >
              <RefreshCw className="size-3" />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={handleDismissAll}
            >
              <Trash2 className="size-3" />
              Dismiss all
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface NotificationItemProps {
  notification: NotificationWithKey
}

const NotificationItem = function NotificationItem({
  notification,
}: NotificationItemProps) {
  const hostId = useHostId()
  const { type, cluster, count, severity, label } = notification

  // Generate link based on notification type
  const href =
    type === 'readonly-tables'
      ? `/readonly-tables?host=${hostId}`
      : type === 'health-check'
        ? `/health?host=${hostId}`
        : `/clusters?host=${hostId}`

  // Generate title and description based on notification type
  const title =
    type === 'readonly-tables'
      ? 'Readonly Tables'
      : type === 'health-check'
        ? (label ?? 'Health Alert')
        : 'Cluster Alert'

  const severityColor =
    severity === 'critical' ? 'text-destructive' : 'text-orange-500'

  return (
    <Link
      href={href}
      className="block rounded-md hover:bg-muted/50 transition-colors group relative"
    >
      <div className="flex items-start gap-3 px-3 py-2.5">
        {/* Icon */}
        <div
          className={cn(
            'rounded-md p-1.5 shrink-0 mt-0.5',
            severity === 'critical' ? 'bg-destructive/10' : 'bg-orange-500/10'
          )}
        >
          <AlertTriangle className={cn('size-4', severityColor)} />
        </div>

        {/* Content - 2-line layout */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium truncate">{title}</p>
            <span
              className={cn(
                'text-xs font-medium tabular-ns',
                severity === 'critical' ? 'text-destructive' : 'text-orange-600'
              )}
            >
              {count}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>in cluster</span>
            <span className="font-mono truncate">{cluster}</span>
          </div>
        </div>

        {/* External link icon */}
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
      </div>
    </Link>
  )
}
