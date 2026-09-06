'use client'

import { PencilIcon } from 'lucide-react'

import { ActionBarPrimitive } from '@assistant-ui/react'
import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button'

export function UserActionBar() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 focus-within:opacity-100"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="text-muted-foreground">
          <PencilIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  )
}
