import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface StatusIndicatorProps {
  title: string[]

  /**
   * Accessible name announced by screen readers (e.g. 'Online', 'Checking',
   * 'Custom connection'). Explicit so non-online dot colors never misreport.
   */
  label: string

  /**
   * Optional CSS className for styling the indicator.
   * - If provided: renders with custom color (e.g., 'bg-emerald-500' for online)
   * - If omitted: renders default red color (offline state)
   */
  className?: string

  size?: string
}

export const StatusIndicator = function StatusIndicator({
  title,
  label,
  className,
  size = 'size-2',
}: StatusIndicatorProps) {
  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn('relative flex cursor-pointer', size)}
              role="status"
              aria-label={label}
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
