import { ReloadIcon } from '@radix-ui/react-icons'
import { useRouter } from '@tanstack/react-router'

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
import { cn } from '@/lib/utils'

export interface ReloadButtonProps {
  className?: string
}

export const ReloadButton = function ReloadButton({
  className,
}: ReloadButtonProps) {
  const router = useRouter()
  const [isLoading, startTransition] = useTransition()
  const { reloadInterval, setReloadInterval } = useAppContext()

  const revalidateCacheAndReload = () =>
    startTransition(async () => {
      router.invalidate()
    })

  const { countDown } = useReloadCountdown({
    reloadInterval,
    onCountdownComplete: revalidateCacheAndReload,
    isLoading,
  })

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
