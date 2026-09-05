'use client'

import {
  ChevronDownIcon,
  ChevronRightIcon,
  type LucideIcon,
} from 'lucide-react'

import type { ReactNode } from 'react'

import { useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

/**
 * A collapsible, chevron-headed section (MCP servers, Skills, Suggested
 * prompts). Defaults to open so nothing is hidden on first visit; returning
 * users can fold away sections they don't need. Every control inside stays
 * reachable — collapsing only hides it, it never removes it.
 */
export function CollapsibleSidebarSection({
  label,
  icon: Icon,
  right,
  defaultOpen = true,
  children,
}: {
  label: string
  icon: LucideIcon
  right?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mb-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          render={
            <button
              type="button"
              className="hover:bg-muted/40 -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1.5 rounded-md px-1 py-1 text-left transition-colors"
            />
          }
        >
          {open ? (
            <ChevronDownIcon className="text-muted-foreground size-3 shrink-0" />
          ) : (
            <ChevronRightIcon className="text-muted-foreground size-3 shrink-0" />
          )}
          <Icon className="text-muted-foreground size-3.5 shrink-0" />
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10.5px] font-semibold tracking-wider uppercase">
            {label}
          </span>
          {right}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1.5">{children}</CollapsibleContent>
      </Collapsible>
    </div>
  )
}
