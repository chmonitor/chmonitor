import { AlertCircle, RefreshCw } from 'lucide-react'

import type { StaleError } from '@/lib/query/use-chart-data'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  detectCardErrorVariant,
  getCardErrorTitle,
} from '@/lib/card-error-utils'
import { cn } from '@/lib/utils'

interface ChartStaleIndicatorProps {
  /** Error from failed revalidation */
  error: StaleError
  /** Callback to retry the fetch */
  onRetry: () => void
  /** When true, always show at 40% opacity. Otherwise hidden until group hover */
  alwaysVisible?: boolean
}

/**
 * ChartStaleIndicator - Shows a subtle warning icon when chart data may be stale
 *
 * Displayed when SWR revalidation fails but previous data exists.
 * Follows the same hover pattern as CardToolbar and DateRangeSelector.
 */
export const ChartStaleIndicator = function ChartStaleIndicator({
  error,
  onRetry,
  alwaysVisible = false,
}: ChartStaleIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false)

  const variant = detectCardErrorVariant(error)
  const title = getCardErrorTitle(variant)
  const timestamp = error.timestamp ? new Date(error.timestamp) : new Date()

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'size-6 transition-opacity rounded-full',
              'text-amber-500 dark:text-amber-400',
              'hover:bg-amber-500/10 dark:hover:bg-amber-400/10',
              'relative before:content-[""] before:absolute before:-inset-4',
              alwaysVisible || isOpen
                ? 'opacity-60 hover:opacity-100'
                : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
            )}
            aria-label="Data may be stale - click for details"
            title="Data may be stale"
          />
        }
      >
        <AlertCircle className="size-3.5" strokeWidth={2} />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-4">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <h4 className="text-sm font-medium">Data may be stale</h4>
              <p className="text-xs text-muted-foreground break-words">
                {title}: {error.message}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
            <span>Failed at {timestamp.toLocaleTimeString()}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => {
                onRetry()
                setIsOpen(false)
              }}
            >
              <RefreshCw className="size-3" />
              Retry now
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
