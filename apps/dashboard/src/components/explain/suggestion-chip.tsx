import type { Suggestion } from '@/lib/explain-heuristics'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface SuggestionChipProps {
  suggestion: Suggestion
  /** Called when the user clicks "Ask AI" — receives suggestion + originating SQL. */
  onAskAgent?: (suggestion: Suggestion, sql: string) => void
  sql: string
}

/**
 * Inline heuristic chip: coloured badge with title. Click to expand the
 * rationale and reveal an optional "Ask AI" shortcut.
 */
export function SuggestionChip({
  suggestion,
  onAskAgent,
  sql,
}: SuggestionChipProps) {
  const [expanded, setExpanded] = useState(false)

  const badgeClass =
    suggestion.severity === 'warning'
      ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
      : 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300'

  if (!expanded) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant="outline"
              className={cn(
                'cursor-pointer text-[11px] font-medium',
                badgeClass
              )}
              onClick={() => setExpanded(true)}
            />
          }
        >
          {suggestion.title}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {suggestion.rationale}
          <p className="mt-1 text-[10px] opacity-70">Click to expand</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      className={cn(
        'rounded-md border p-2.5 text-xs',
        suggestion.severity === 'warning'
          ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
          : 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Badge
          variant="outline"
          className={cn('shrink-0 text-[11px] font-medium', badgeClass)}
        >
          {suggestion.title}
        </Badge>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <p className="mt-1.5 leading-relaxed text-muted-foreground">
        {suggestion.rationale}
      </p>
      {onAskAgent && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1.5 h-6 px-2 text-[11px]"
          onClick={() => onAskAgent(suggestion, sql)}
        >
          Ask AI
        </Button>
      )}
    </div>
  )
}
