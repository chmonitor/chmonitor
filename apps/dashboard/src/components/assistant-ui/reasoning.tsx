'use client'

/**
 * Reasoning components for displaying chain-of-thought / thinking output.
 *
 * Ghost / muted styling intentionally signals "background processing" —
 * the content feels secondary to the final assistant answer.
 */

import { ChevronRightIcon, SparklesIcon } from 'lucide-react'

import { useScrollLock } from '@assistant-ui/react'
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
// ReasoningRoot
// ---------------------------------------------------------------------------

interface ReasoningRootProps extends PropsWithChildren {
  className?: string
  defaultOpen?: boolean
  /**
   * When the run is streaming the block auto-expands; once it finishes it
   * auto-collapses. A manual toggle stops the auto-sync for this block's life.
   */
  isRunning?: boolean
}

/**
 * Collapsible container for reasoning / chain-of-thought content.
 * Uses ghost/muted styling so it reads as background-layer content.
 *
 * Controlled when `isRunning` is provided: the active (streaming) block stays
 * expanded while finished blocks collapse. A manual toggle wins permanently.
 */
export function ReasoningRoot({
  children,
  className,
  defaultOpen = false,
  isRunning,
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null)
  const lockScroll = useScrollLock(collapsibleRef, 220)

  const controlled = isRunning !== undefined
  const userToggledRef = useRef(false)
  const [open, setOpen] = useState(isRunning ?? defaultOpen)

  // Follow isRunning until the user takes manual control.
  useEffect(() => {
    if (controlled && !userToggledRef.current) {
      setOpen(isRunning ?? false)
    }
  }, [controlled, isRunning])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (controlled) {
        userToggledRef.current = true
        setOpen(next)
      }
      lockScroll()
    },
    [controlled, lockScroll]
  )

  return (
    <Collapsible
      ref={collapsibleRef}
      {...(controlled
        ? { open, onOpenChange: handleOpenChange }
        : { defaultOpen, onOpenChange: lockScroll })}
      className={cn('group/reasoning', className)}
    >
      {children}
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// ReasoningTrigger
// ---------------------------------------------------------------------------

interface ReasoningTriggerProps extends PropsWithChildren {
  /** When true, shows a shimmer indicating active streaming. */
  active?: boolean
  className?: string
}

/**
 * Toggle button for the reasoning collapsible.
 * Renders a subtle Sparkles icon + label; chevron rotates when open.
 */
export function ReasoningTrigger({
  children,
  active,
  className,
}: ReasoningTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-full items-center gap-1.5 px-3 py-2 rounded-md',
        'bg-purple-50/50 dark:bg-purple-950/20',
        'text-xs font-medium text-purple-700 dark:text-purple-300',
        'hover:bg-purple-100/50 dark:hover:bg-purple-950/30 transition-colors',
        className
      )}
    >
      <SparklesIcon
        className={cn(
          'size-3.5 shrink-0 text-purple-600 dark:text-purple-400',
          active && 'animate-pulse'
        )}
      />
      <span className="flex-1 text-left">{children ?? 'Thought process'}</span>
      <ChevronRightIcon className="size-3 shrink-0 text-purple-600 dark:text-purple-400 transition-transform duration-200 group-data-[state=open]/reasoning:rotate-90" />
    </CollapsibleTrigger>
  )
}

// ---------------------------------------------------------------------------
// ReasoningContent
// ---------------------------------------------------------------------------

interface ReasoningContentProps extends PropsWithChildren {
  className?: string
}

/**
 * Animated collapsible body for reasoning text.
 */
export function ReasoningContent({
  children,
  className,
}: ReasoningContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        'overflow-hidden',
        'data-closed:animate-collapsible-up',
        'data-open:animate-collapsible-down'
      )}
    >
      <div className={cn('px-3 py-2', className)}>{children}</div>
    </CollapsibleContent>
  )
}

// ---------------------------------------------------------------------------
// ReasoningText
// ---------------------------------------------------------------------------

interface ReasoningTextProps {
  text: string
  className?: string
}

/**
 * Pre-formatted reasoning text with muted / italic ghost styling.
 */
export function ReasoningText({ text, className }: ReasoningTextProps) {
  if (!text?.trim()) return null
  return (
    <p
      className={cn(
        'whitespace-pre-wrap text-xs italic text-muted-foreground/80 leading-relaxed',
        className
      )}
    >
      {text}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Convenience: Reasoning (all-in-one)
// ---------------------------------------------------------------------------

interface ReasoningProps {
  text: string
  active?: boolean
  className?: string
}

/**
 * Convenience wrapper that composes ReasoningRoot + Trigger + Content + Text.
 * Use the sub-components directly when you need more control.
 */
export function Reasoning({ text, active, className }: ReasoningProps) {
  if (!text?.trim()) return null
  return (
    <ReasoningRoot className={className}>
      <ReasoningTrigger active={active} />
      <ReasoningContent>
        <ReasoningText text={text} />
      </ReasoningContent>
    </ReasoningRoot>
  )
}
