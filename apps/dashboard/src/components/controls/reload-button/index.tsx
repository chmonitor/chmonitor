import { ReloadIcon } from '@radix-ui/react-icons'

import { useReloadCountdown } from './use-reload-countdown'
import { useReloadIntervals } from './use-reload-intervals'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppContext } from '@/lib/context/app-context'
import { formatReadableSecondDuration } from '@/lib/format-readable'
import { useRouter } from '@/lib/next-compat'
import { cn } from '@/lib/utils'

export interface ReloadButtonProps {
  className?: string
}

/**
 * Reload button with auto-reload countdown timer
 *
 * Features:
 * - Manual reload with keyboard shortcut (Cmd+R)
 * - Auto-reload with configurable intervals (30s, 1m, 2m, 10m, 30m)
 * - Countdown timer display showing time until next reload
 * - Disable auto-reload option
 *
 * @example
 * ```tsx
 * <ReloadButton className="ml-auto" />
 * ```
 */
export const ReloadButton = function ReloadButton({
  className,
}: ReloadButtonProps) {
  const router = useRouter()
  const [isLoading, startTransition] = useTransition()
  const { reloadInterval, setReloadInterval } = useAppContext()

  // Handle manual refresh
  const revalidateCacheAndReload = () =>
    startTransition(async () => {
      router.refresh()
    })

  // Countdown timer hook
  const { countDown } = useReloadCountdown({
    reloadInterval,
    onCountdownComplete: revalidateCacheAndReload,
    isLoading,
  })

  // Interval management hook
  const { intervals, setInterval, disableAutoReload } = useReloadIntervals({
    reloadInterval,
    setReloadInterval,
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            aria-label="Reload"
            className={cn(
              'flex flex-row gap-2',
              className,
              isLoading ? 'animate-pulse' : ''
            )}
          />
        }
      >
        <span className="font-mono">
          {formatReadableSecondDuration(countDown)}
        </span>
        <ReloadIcon
          aria-label="Reload icon"
          data-testid="reload-icon"
          className={cn('size-4', isLoading ? 'animate-spin' : '')}
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-56">
        <DropdownMenuItem onClick={revalidateCacheAndReload}>
          Reload (Clear Cache)
          <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {intervals.map((interval) => (
          <DropdownMenuItem
            key={interval.value}
            onClick={() => setInterval(interval.value)}
          >
            {interval.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={disableAutoReload}>
          Disable Auto
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
