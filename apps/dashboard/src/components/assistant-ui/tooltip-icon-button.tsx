'use client'

import type { ComponentPropsWithoutRef, ComponentRef } from 'react'

import { forwardRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type TooltipIconButtonProps = ComponentPropsWithoutRef<typeof Button> & {
  tooltip: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * Icon-only button with an accessible tooltip — shared by the assistant-ui
 * Thread, action bar, composer and thread-list components.
 */
export const TooltipIconButton = forwardRef<
  ComponentRef<typeof Button>,
  TooltipIconButtonProps
>(({ children, tooltip, side = 'bottom', className, ...rest }, ref) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              {...rest}
              className={cn('aui-button-icon size-6 p-1', className)}
              ref={ref}
            />
          }
        >
          {children}
          <span className="sr-only">{tooltip}</span>
        </TooltipTrigger>
        <TooltipContent side={side}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
})

TooltipIconButton.displayName = 'TooltipIconButton'
