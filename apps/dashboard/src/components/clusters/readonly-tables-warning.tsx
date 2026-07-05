/**
 * Readonly Tables Warning Indicator
 *
 * Displays a warning indicator when there are readonly tables in a cluster.
 * Readonly tables indicate critical issues like ZooKeeper problems or disk failures.
 *
 * Features:
 * - Hidden when count is 0 (cluster is healthy)
 * - Red/destructive styling to indicate urgency
 * - Popover with details on click
 * - Links to readonly tables page for full details
 */

import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react'

import { useState } from 'react'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useClusterCount } from '@/lib/swr/use-cluster-count'
import { cn } from '@/lib/utils'

interface ReadonlyTablesWarningProps {
  /** Host ID for the API call */
  hostId: number
  /** Cluster name to check */
  cluster: string
  /** Always show or only on hover */
  alwaysVisible?: boolean
}

/**
 * ReadonlyTablesWarning - Shows a warning when cluster has readonly tables
 *
 * Displays a red warning indicator with count badge.
 * Click to see details and link to full readonly tables page.
 */
export const ReadonlyTablesWarning = function ReadonlyTablesWarning({
  hostId,
  cluster,
  alwaysVisible = true,
}: ReadonlyTablesWarningProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { count, isLoading, error, refresh } = useClusterCount(
    'readonly-tables-in-cluster',
    hostId,
    cluster
  )

  // Don't render if loading, error, or count is 0
  if (isLoading || error || count === null || count === 0) {
    return null
  }

  const readonlyTablesUrl = `/readonly-tables?host=${hostId}`

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'gap-1.5 h-8 px-2.5',
              'text-destructive hover:text-destructive',
              'hover:bg-destructive/10',
              'transition-opacity',
              alwaysVisible || isOpen
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100'
            )}
            aria-label={`${count} readonly tables - click for details`}
          />
        }
      >
        <AlertTriangle className="size-4" />
        <span className="font-medium tabular-nums">{count}</span>
        <span className="text-xs font-normal">readonly</span>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-destructive/10 p-2">
              <AlertTriangle className="size-5 text-destructive" />
            </div>
            <div className="space-y-1 min-w-0 flex-1">
              <h4 className="text-sm font-medium">Readonly Tables Detected</h4>
              <p className="text-xs text-muted-foreground">
                {count} {count === 1 ? 'table is' : 'tables are'} in readonly
                mode in cluster <code className="font-mono">{cluster}</code>
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <p>
              Readonly tables cannot accept writes. This typically indicates:
            </p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li>ZooKeeper/Keeper connection issues</li>
              <li>Disk space problems</li>
              <li>Quorum loss in replicated tables</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => {
                refresh()
              }}
            >
              <RefreshCw className="size-3" />
              Refresh
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              render={<Link href={readonlyTablesUrl} />}
            >
              View all
              <ExternalLink className="size-3" />
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
