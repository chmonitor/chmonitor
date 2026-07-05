import { RefreshCw } from 'lucide-react'

import { useRefreshTimer } from './hooks'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppContext } from '@/lib/context/app-context'
import { formatReadableSecondDuration } from '@/lib/format-readable'
import { cn } from '@/lib/utils'

const SECOND = 1000
const MINUTE = 60 * SECOND

export const RefreshCountdown = function RefreshCountdown() {
  const { reloadInterval, setReloadInterval } = useAppContext()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const { remaining, reset } = useRefreshTimer({
    interval: reloadInterval ?? undefined,
    enabled: reloadInterval != null,
    onRefresh: () => {
      setIsRefreshing(true)
      window.dispatchEvent(new CustomEvent('swr:revalidate'))
      setTimeout(() => setIsRefreshing(false), 1000)
    },
  })

  const handleRefresh = () => {
    setIsRefreshing(true)
    window.dispatchEvent(new CustomEvent('swr:revalidate'))
    setTimeout(() => {
      setIsRefreshing(false)
      reset()
    }, 1000)
  }

  const handleSetReloadInterval = (interval: number | null) => {
    setReloadInterval(interval)
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-8 shrink-0 gap-1.5 px-2 text-xs font-normal',
              isRefreshing && 'animate-pulse'
            )}
            aria-label={`Auto refresh ${reloadInterval ? `in ${formatReadableSecondDuration(remaining)}` : 'disabled'}. Click to change.`}
          />
        }
      >
        <RefreshCw
          className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')}
          aria-hidden="true"
        />
        <span className="hidden font-mono text-muted-foreground tabular-nums sm:inline">
          {reloadInterval ? formatReadableSecondDuration(remaining) : 'Off'}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={handleRefresh}>Refresh now</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleSetReloadInterval(30 * SECOND)}>
          30 seconds
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleSetReloadInterval(1 * MINUTE)}>
          1 minute
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleSetReloadInterval(2 * MINUTE)}>
          2 minutes
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleSetReloadInterval(5 * MINUTE)}>
          5 minutes
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleSetReloadInterval(null)}>
          Disable auto-refresh
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
