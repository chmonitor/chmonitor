import { Maximize2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * The "zoom to" affordance in a chart card's toolbar.
 *
 * Deliberately split out of `chart-zoom-dialog.tsx`: `ChartContainer` wraps
 * every chart in the app and needs this button eagerly, but the dialog module
 * pulls in the whole data-table system. Keeping the button here lets the dialog
 * itself be lazy-loaded — see `chart-container.tsx`.
 */
export interface ChartZoomButtonProps {
  onClick: () => void
  disabled?: boolean
}

export const ChartZoomButton = function ChartZoomButton({
  onClick,
  disabled = false,
}: ChartZoomButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={onClick}
            disabled={disabled}
            aria-label="Zoom chart"
            className={cn(
              'size-6 rounded-full transition-opacity',
              'relative before:content-[""] before:absolute before:-inset-4',
              'opacity-0 group-hover:opacity-40 hover:!opacity-100'
            )}
          />
        }
      >
        <Maximize2Icon className="size-3.5" strokeWidth={2} />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        Zoom to
      </TooltipContent>
    </Tooltip>
  )
}
