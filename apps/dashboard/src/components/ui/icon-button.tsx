import type { ComponentProps, ReactNode } from 'react'

import { Button } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'
import { memo } from 'react'
import { cn } from '@/lib/utils'

interface IconButtonProps extends Omit<ComponentProps<typeof Button>, 'size'> {
  /** Tooltip text to display on hover */
  tooltip: string
  /** Icon to render inside the button */
  icon: ReactNode
  /** Optional keyboard shortcut to display in tooltip */
  shortcut?: string
  /** Button size - defaults to 'icon' */
  size?: 'sm' | 'default' | 'lg'
  /** Side of the tooltip */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

const sizeClasses = {
  sm: 'h-7 w-7',
  default: 'h-8 w-8',
  lg: 'h-9 w-9',
}

const iconSizes = {
  sm: 'h-3.5 w-3.5',
  default: 'h-4 w-4',
  lg: 'h-5 w-5',
}

/**
 * Icon button with built-in tooltip support.
 * Use this for any icon-only button to ensure accessibility.
 */
export const IconButton = memo(function IconButton({
  tooltip,
  icon,
  shortcut,
  size = 'default',
  tooltipSide = 'bottom',
  className,
  suppressHydrationWarning,
  ...props
}: IconButtonProps & { suppressHydrationWarning?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              sizeClasses[size],
              'text-muted-foreground',
              'relative before:content-[""] before:absolute before:-inset-4',
              className
            )}
            aria-label={tooltip}
            suppressHydrationWarning={suppressHydrationWarning}
            {...props}
          />
        }
      >
        <span className={iconSizes[size]}>{icon}</span>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="flex items-center gap-2">
        <span>{tooltip}</span>
        {shortcut && (
          <kbd className="rounded border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  )
})
