'use client'

/**
 * Compact "current page" chip shown above the floating agent's composer. It
 * makes the widget's page awareness VISIBLE — the agent already receives the
 * page as `pageContext` (see `agent-runtime-provider.tsx`), and this chip tells
 * the user so, e.g. `⌞ Fleet Overview`. Clicking × drops page context for the
 * current page (re-arms on navigation).
 *
 * Renders nothing when there's no page-context control (the full `/agents`
 * page, which never mounts the provider), no resolvable page, or the user has
 * dismissed it — so it's strictly a floating-widget affordance.
 */

import { TextQuoteIcon, XIcon } from 'lucide-react'

import { usePageContextControl } from '@/components/assistant-ui/page-context-control'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function PageContextChip({ className }: { className?: string }) {
  const control = usePageContextControl()
  if (!control || !control.enabled) return null

  const label = control.pageContext?.label ?? control.pageContext?.route
  if (!label) return null

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              className={cn(
                'bg-muted/60 text-muted-foreground inline-flex max-w-full items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs',
                className
              )}
            />
          }
        >
          <TextQuoteIcon className="size-3 shrink-0" />
          <span className="truncate font-medium">{label}</span>
          <button
            type="button"
            aria-label="Drop page context for this message"
            onClick={control.disable}
            className="hover:bg-muted hover:text-foreground ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors"
          >
            <XIcon className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          The agent can see the page you're on
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
