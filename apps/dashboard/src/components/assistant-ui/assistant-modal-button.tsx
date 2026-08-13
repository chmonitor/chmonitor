'use client'

/**
 * The floating agent's bubble trigger.
 *
 * Deliberately in its own module with no assistant-ui imports: the collapsed
 * bubble is all that renders on a dashboard page until the user actually opens
 * the agent, so it must not drag in the Thread chunk. See
 * `global-assistant-modal.tsx` for the gate that relies on this.
 */

import { BotIcon, XIcon } from 'lucide-react'

import { forwardRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ButtonProps = React.ComponentPropsWithoutRef<typeof Button>

export const AssistantModalButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & { 'data-state'?: string }
>(({ 'data-state': state, ...rest }, ref) => {
  const open = state === 'open'
  return (
    <Button
      {...rest}
      ref={ref}
      data-state={state}
      size="icon"
      aria-label={open ? 'Close agent' : 'Open agent'}
      className="size-11 rounded-full transition-transform hover:scale-105"
    >
      <span
        className={cn(
          'absolute transition-all',
          open ? 'rotate-90 scale-0' : 'rotate-0 scale-100'
        )}
      >
        <BotIcon className="size-5" />
      </span>
      <span
        className={cn(
          'absolute transition-all',
          open ? 'rotate-0 scale-100' : 'rotate-90 scale-0'
        )}
      >
        <XIcon className="size-5" />
      </span>
    </Button>
  )
})
AssistantModalButton.displayName = 'AssistantModalButton'
