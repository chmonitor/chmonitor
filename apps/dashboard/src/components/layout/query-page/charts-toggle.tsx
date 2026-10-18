import { LayoutDashboardIcon, MinimizeIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

export interface ChartsToggleProps {
  isCollapsed: boolean
  onToggle: () => void
}

export function ChartsToggle({ isCollapsed, onToggle }: ChartsToggleProps) {
  return (
    <div className="flex items-center justify-end">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggle}
        className="h-7 gap-1 px-2 text-xs"
        aria-label={isCollapsed ? 'Expand charts' : 'Collapse charts'}
      >
        {isCollapsed ? (
          <>
            <span>Expand Charts</span>
            <LayoutDashboardIcon className="size-3.5" />
          </>
        ) : (
          <>
            <span>Collapse Charts</span>
            <MinimizeIcon className="size-3.5" />
          </>
        )}
      </Button>
    </div>
  )
}
