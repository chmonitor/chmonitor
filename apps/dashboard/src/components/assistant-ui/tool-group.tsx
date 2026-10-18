'use client'

import { ChevronRightIcon, WrenchIcon } from 'lucide-react'

import type {
  MessagePartStatus,
  ToolCallMessagePartStatus,
} from '@assistant-ui/react'

import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ToolGroupRootProps extends PropsWithChildren {
  className?: string
  defaultOpen?: boolean
  /**
   * When the run is streaming the block auto-expands; once it finishes it
   * auto-collapses. A manual toggle stops the auto-sync for this block's life.
   */
  isRunning?: boolean
}

export function ToolGroupRoot({
  children,
  className,
  defaultOpen = true,
  isRunning,
}: ToolGroupRootProps) {
  const controlled = isRunning !== undefined
  const userToggledRef = useRef(false)
  const [open, setOpen] = useState(isRunning ?? defaultOpen)

  useEffect(() => {
    if (controlled && !userToggledRef.current) {
      setOpen(isRunning ?? false)
    }
  }, [controlled, isRunning])

  const handleOpenChange = useCallback((next: boolean) => {
    userToggledRef.current = true
    setOpen(next)
  }, [])

  return (
    <Collapsible
      {...(controlled
        ? { open, onOpenChange: handleOpenChange }
        : { defaultOpen })}
      className={cn('group/toolgroup', className)}
    >
      {children}
    </Collapsible>
  )
}

interface ToolGroupTriggerProps {
  count?: number
  /** `status` of the group part from MessagePrimitive.GroupedParts. */
  status?: MessagePartStatus | ToolCallMessagePartStatus
  className?: string
}

export function ToolGroupTrigger({
  count,
  status,
  className,
}: ToolGroupTriggerProps) {
  const isRunning = status?.type === 'running'

  return (
    <CollapsibleTrigger
      className={cn(
        // Ghost text row, not a background card — matches ReasoningTrigger's
        // weight so the two "chat machinery" collapsibles read as siblings,
        // differentiated by icon/label rather than a stacked grey slab each.
        '-mx-1.5 flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1',
        'text-xs font-medium text-muted-foreground',
        'outline-none transition-colors hover:bg-muted/40 hover:text-foreground',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className
      )}
    >
      <WrenchIcon
        className={cn('size-3.5 shrink-0', isRunning && 'animate-pulse')}
      />
      <span className="flex-1 text-left">
        {count != null && count > 0
          ? `${count} tool call${count !== 1 ? 's' : ''}`
          : 'Tool calls'}
      </span>
      {isRunning && (
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--chart-yellow)]" />
      )}
      <ChevronRightIcon className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]/toolgroup:rotate-90" />
    </CollapsibleTrigger>
  )
}

interface ToolGroupContentProps extends PropsWithChildren {
  className?: string
}

export function ToolGroupContent({
  children,
  className,
}: ToolGroupContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        'overflow-hidden',
        'data-closed:animate-collapsible-up',
        'data-open:animate-collapsible-down'
      )}
    >
      <div className={cn('flex flex-col gap-0.5 pl-3.5', className)}>
        {children}
      </div>
    </CollapsibleContent>
  )
}
