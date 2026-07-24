'use client'

/**
 * ToolGroup components: collapsible container for adjacent tool calls.
 *
 * When any contained tool is still running, the trigger shows an active
 * spinner to communicate "tools in progress".
 */

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

// ---------------------------------------------------------------------------
// ToolGroupRoot
// ---------------------------------------------------------------------------

interface ToolGroupRootProps extends PropsWithChildren {
  className?: string
  defaultOpen?: boolean
  /**
   * When the run is streaming the block auto-expands; once it finishes it
   * auto-collapses. A manual toggle stops the auto-sync for this block's life.
   */
  isRunning?: boolean
}

/**
 * Collapsible root container for a set of adjacent tool calls.
 *
 * Controlled when `isRunning` is provided: the active (streaming) run stays
 * expanded while finished runs collapse into tidy history. A manual toggle
 * wins permanently.
 */
export function ToolGroupRoot({
  children,
  className,
  defaultOpen = true,
  isRunning,
}: ToolGroupRootProps) {
  const controlled = isRunning !== undefined
  const userToggledRef = useRef(false)
  const [open, setOpen] = useState(isRunning ?? defaultOpen)

  // Follow isRunning until the user takes manual control.
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

// ---------------------------------------------------------------------------
// ToolGroupTrigger
// ---------------------------------------------------------------------------

interface ToolGroupTriggerProps {
  /** Total number of tool calls in this group. */
  count?: number
  /**
   * Pass the `status` of the group part from MessagePrimitive.GroupedParts.
   * When `status.type === "running"`, shows an animated spinner.
   */
  status?: MessagePartStatus | ToolCallMessagePartStatus
  className?: string
}

/**
 * Toggle button for the tool group. Shows count + spinner when running.
 */
export function ToolGroupTrigger({
  count,
  status,
  className,
}: ToolGroupTriggerProps) {
  const isRunning = status?.type === 'running'

  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-full items-center gap-1.5 px-3 py-2 rounded-md',
        'bg-muted/50',
        'text-xs font-medium text-muted-foreground',
        'hover:bg-muted transition-colors',
        className
      )}
    >
      <WrenchIcon
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground',
          isRunning && 'animate-pulse'
        )}
      />
      <span className="flex-1 text-left">
        {count != null && count > 0
          ? `${count} tool call${count !== 1 ? 's' : ''}`
          : 'Tool calls'}
      </span>
      {isRunning && (
        <span className="mr-1 inline-block size-2 animate-pulse rounded-full bg-primary/60" />
      )}
      <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/toolgroup:rotate-90" />
    </CollapsibleTrigger>
  )
}

// ---------------------------------------------------------------------------
// ToolGroupContent
// ---------------------------------------------------------------------------

interface ToolGroupContentProps extends PropsWithChildren {
  className?: string
}

/**
 * Animated collapsible body containing the individual tool call renderers.
 */
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
      <div className={cn('flex flex-col gap-0', className)}>{children}</div>
    </CollapsibleContent>
  )
}
