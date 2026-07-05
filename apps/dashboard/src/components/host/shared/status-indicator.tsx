import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Props for StatusIndicator component.
 */
export interface StatusIndicatorProps {
  /**
   * Tooltip content lines to display on hover.
   */
  title: string[]

  /**
   * Optional CSS className for styling the indicator.
   * - If provided: renders with custom color (e.g., 'bg-emerald-500' for online)
   * - If omitted: renders default red color (offline state)
   */
  className?: string

  /**
   * Optional size override. Default is 'size-2'.
   */
  size?: string
}

/**
 * Status indicator component with tooltip support.
 * Displays a colored dot with accessibility attributes and tooltip on hover.
 *
 * @example Online state
 * <StatusIndicator
 *   className="bg-emerald-500"
 *   title={['Host: server1', 'Online: 2 days', 'Version: 24.3.1']}
 * />
 *
 * @example Offline state
 * <StatusIndicator title={['The host is offline']} />
 *
 * @example Loading state
 * <StatusIndicator
 *   className="bg-gray-400 animate-pulse"
 *   title={['Loading...']}
 * />
 */
export const StatusIndicator = function StatusIndicator({
  title,
  className,
  size = 'size-2',
}: StatusIndicatorProps) {
  const isOnline = className !== undefined
  const statusText = isOnline ? 'Online' : 'Offline'

  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn('relative flex cursor-pointer', size)}
              role="status"
              aria-label={statusText}
            />
          }
        >
          <span
            className={cn(
              'absolute inline-flex rounded-full',
              size,
              !className && 'bg-red-400',
              className
            )}
            aria-hidden="true"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {title.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
