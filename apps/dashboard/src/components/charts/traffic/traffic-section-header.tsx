/**
 * TrafficSectionHeader — shared header row for /traffic sections: icon +
 * title on the left, a full/compact density toggle on the right. Compact mode
 * renders the section's charts as a dense mini-chart row; the preference is
 * persisted per section in traffic-view-settings (localStorage).
 */

import { LayoutGridIcon, Rows3Icon } from 'lucide-react'

import type { TrafficSectionDensity } from '@/lib/traffic/traffic-settings'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function TrafficSectionHeader({
  icon,
  title,
  density,
  onToggleDensity,
}: {
  icon?: React.ReactNode
  /** Omit when the section body renders its own title (e.g. a table card). */
  title?: string
  density: TrafficSectionDensity
  onToggleDensity: () => void
}) {
  const compact = density === 'compact'
  return (
    <div className="flex items-center gap-2">
      {icon}
      {title ? (
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleDensity}
              aria-label={
                compact ? 'Expand to full charts' : 'Collapse to compact row'
              }
              className="ml-auto size-6 text-muted-foreground"
            />
          }
        >
          {compact ? (
            <LayoutGridIcon className="size-3.5" strokeWidth={1.5} />
          ) : (
            <Rows3Icon className="size-3.5" strokeWidth={1.5} />
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {compact ? 'Full charts' : 'Compact row'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
