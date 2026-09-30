import { Maximize2Icon } from 'lucide-react'

import { chartActionClass } from '@/components/cards/chart-action-classes'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

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
            className={chartActionClass()}
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
